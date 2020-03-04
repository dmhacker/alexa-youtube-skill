"use strict";

// Setup Python-esque formatting
String.prototype.formatUnicorn = String.prototype.formatUnicorn || require("./util/formatting.js");

// Required packages
let alexa = require("alexa-app");
let request = require("request");
let ssml = require("ssml-builder");
let response_messages = require("./util/responses.js");

// Create Alexa skill application
let app = new alexa.app("youtube");

// Process environment variables 
const HEROKU = process.env.HEROKU_APP_URL || "https://dmhacker-youtube.herokuapp.com";
const INTERACTIVE_WAIT = !(process.env.DISABLE_INTERACTIVE_WAIT === "true" ||
  process.env.DISABLE_INTERACTIVE_WAIT === true ||
  process.env.DISABLE_INTERACTIVE_WAIT === 1);
const CACHE_POLLING_INTERVAL = Math.max(1000, parseInt(process.env.CACHE_POLLING_INTERVAL || "5000", 10));
const ASK_INTERVAL = Math.max(30000, parseInt(process.env.ASK_INTERVAL || "45000", 10));

// Maps user IDs to recently searched video metadata
let buffer_search = {};

// Maps user IDs to last played video metadata
let last_search = {};
let last_token = {};
let last_playback = {};

// Indicates song repetition preferences for user IDs 
let repeat_infinitely = new Set();
let repeat_once = new Set();

// Set of users waiting for downloads to finishes
let downloading_users = new Set();

/**
 * Generates a random UUID. Used for creating an audio stream token.
 *
 * @return {String} A random globally unique UUID
 */
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    let r = Math.random() * 16 | 0,
      v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Returns whether a user is streaming video or not.
 * By default, if this is true, then the user also has_video() as well.
 *
 * @return {Boolean} The state of the user's audio stream
 */
function is_streaming_video(user_id) {
  return last_token.hasOwnProperty(user_id) && last_token[user_id] != null;
}

/**
 * Returns whether a user has downloaded a video.
 * Doesn't take into account if the user is currently playing it.
 *
 * @return {Boolean} The state of the user's audio reference
 */
function has_video(user_id) {
  return last_search.hasOwnProperty(user_id) && last_search[user_id] != null;
}

/**
 * Restarts the video by injecting the last search URL as a new stream.
 *
 * @param  {Object} res    A response that will be sent to the Alexa device
 * @param  {Number} offset How many milliseconds from the video start to begin at
 */
function restart_video(req, res, offset) {
  let user_id = req.userId;
  last_token[user_id] = uuidv4();
  res.audioPlayerPlayStream("REPLACE_ALL", {
    url: last_search[user_id],
    streamFormat: "AUDIO_MPEG",
    token: last_token[user_id],
    offsetInMilliseconds: offset
  });
  if (!last_playback.hasOwnProperty(user_id)) {
    last_playback[user_id] = {};
  }
  last_playback[user_id].start = new Date().getTime();
}

/**
 * Searches for a YouTube video matching the user's query.
 *
 * @param  {Object}  req  A request from an Alexa device
 * @param  {Object}  res  A response that will be sent to the device
 * @param  {String}  lang The language of the query
 * @return {Promise} Execution of the request
 */
function search_video(req, res, lang) {
  let user_id = req.userId;
  let query = req.slot("VideoQuery");
  console.log(`User ${user_id} entered search query '${query}'.`);
  return new Promise((resolve, reject) => {
    let search_url = `${HEROKU}/alexa/v3/search/${Buffer.from(query).toString("base64")}`;
    if (lang === "de-DE") {
      search_url += "?language=de";
    } else if (lang === "fr-FR") {
      search_url += "?language=fr";
    } else if (lang === "it-IT") {
      search_url += "?language=it";
    }
    request(search_url, function(err, res, body) {
      if (err) {
        reject(err.message);
      } else {
        let body_json = JSON.parse(body);
        if (body_json.state === "error" && body_json.message === "No results found") {
          resolve({
            message: response_messages[lang]["NO_RESULTS_FOUND"].formatUnicorn(query),
            metadata: null
          });
        } else {
          let metadata = body_json.video;
          console.log(`Search result is '${metadata.title} at ${metadata.link}.`);
          resolve({
            message: response_messages[lang]["ASK_TO_PLAY"].formatUnicorn(metadata.title),
            metadata: metadata
          });
        }
      }
    });
  }).then(function(content) {
    let speech = new ssml();
    speech.say(content.message);
    res.say(speech.ssml(true));
    if (content.metadata) {
      let metadata = content.metadata;
      res.card({
        type: "Simple",
        title: "Search for \"" + query + "\"",
        content: "Alexa found \"" + metadata.title + "\" at " + metadata.link + "."
      });
      buffer_search[user_id] = metadata;
      downloading_users.delete(user_id);
      res.reprompt().shouldEndSession(false);
    }
    res.send();
  }).catch(function(reason) {
    res.fail(reason);
  });
}

/**
 * Runs when a video download finishes. Alerts Alexa via the card system
 * and begins playing the audio.
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 */
function on_download_finish(req, res) {
  let user_id = req.userId;
  let speech = new ssml();
  let title = buffer_search[user_id].title;
  let message = response_messages[req.data.request.locale]["NOW_PLAYING"].formatUnicorn(title);
  speech.say(message);
  res.say(speech.ssml(true));
  console.log(`${title} is now being played.`);
  restart_video(req, res, 0);
}

/**
 * Signals to the server that the video corresponding to the
 * given ID should be downloaded.
 *
 * @param  {String}  id       The ID of the video
 * @return {Promise} Execution of the request
 */
function request_interactive_download(id) {
  return new Promise((resolve, reject) => {
    request(`${HEROKU}/alexa/v3/download/${id}`, function(err, res, body) {
      if (err) {
        console.error(err.message);
        reject(err.message);
      } else {
        let body_json = JSON.parse(body);
        let url = HEROKU + body_json.link;
        console.log(`${url} has started downloading.`);
        resolve(url);
      }
    });
  });
}

/**
 * Executes an interactive wait. This means that the Alexa device will
 * continue its normal cache polling routine but will ask the user at
 * a specified interval whether or not to continue the download. Fixes
 * issues with Alexa not being able to be interrupted for long downloads.
 *
 * @param  {Object}  req  A request from an Alexa device
 * @param  {Object}  res  A response that will be sent to the device
 * @return {Promise} Execution of the request
 */
function wait_on_interactive_download(req, res) {
  let user_id = req.userId;
  return ping_on_interactive_download(req, buffer_search[user_id].id, ASK_INTERVAL).then(() => {
    if (downloading_users.has(user_id)) {
      let message = response_messages[req.data.request.locale]["ASK_TO_CONTINUE"];
      let speech = new ssml();
      speech.say(message);
      res.say(speech.ssml(true));
      res.reprompt(message).shouldEndSession(false);
      console.log("User has been asked if they want to continue with download.");
    } else {
      on_download_finish(req, res);
    }
    return res.send();
  }).catch(reason => {
    console.error(reason);
    return res.fail(reason);
  });
}

/**
 * Pings the cache at a normal polling interval until either the specified 
 * timeout is reached or the cache finishes downloading the given video.
 *
 * SUBROUTINE for wait_on_interactive_download() method. 
 *
 * @param  {Object}  req     A request from an Alexa device
 * @param  {String}  id      The ID of the video
 * @param  {Number}  timeout The remaining time to wait until the user is prompted 
 * @return {Promise} Execution of the request
 */
function ping_on_interactive_download(req, id, timeout) {
  let user_id = req.userId;
  return new Promise((resolve, reject) => {
    request(`${HEROKU}/alexa/v3/cache/${id}`, function(err, res, body) {
      if (!err) {
        let body_json = JSON.parse(body);
        if (body_json.hasOwnProperty('downloaded') && body_json['downloaded'] != null) {
          if (body_json.downloaded) {
            downloading_users.delete(user_id);
            console.log(`${id} has finished downloading.`);
            resolve();
          } else {
            downloading_users.add(user_id);
            if (timeout <= 0) {
              resolve();
              return;
            }
            let interval = Math.min(CACHE_POLLING_INTERVAL, timeout);
            console.log(`Still downloading. Next ping occurs in ${interval} ms.`);
            console.log(`User will be prompted in ${timeout} ms.`);
            resolve(new Promise((_resolve, _reject) => {
              setTimeout(() => {
                _resolve(ping_on_interactive_download(req, id, timeout - CACHE_POLLING_INTERVAL)
                  .catch(_reject));
              }, interval);
            }).catch(reject));
          }
        } else {
          console.error(`${id} is not being cached. Did an error occur?`);
          reject('Video unavailable.');
        }
      } else {
        console.error(err.message);
        reject(err.message);
      }
    });
  });
}

/**
 * Executes a blocking download to fetch the last video the user requested.
 * A blocking download implies that Alexa will simply wait for the video 
 * to download until the download either finishes or times out.
 *
 * @param  {Object}  req  A request from an Alexa device
 * @param  {Object}  res  A response that will be sent to the device
 * @return {Promise} Execution of the request
 */
function request_blocking_download(req, res) {
  let user_id = req.userId;
  let id = buffer_search[user_id].id;
  console.log(`${id} was requested for download.`);
  return new Promise((resolve, reject) => {
    request(`${HEROKU}/alexa/v3/download/${id}`, function(err, res, body) {
      if (err) {
        reject(err.message);
      } else {
        let body_json = JSON.parse(body);
        last_search[user_id] = HEROKU + body_json.link;

        // NOTE: hack to get Alexa to ignore a bad PlaybackNearlyFinished event
        repeat_once.add(user_id);
        repeat_infinitely.delete(user_id);

        console.log(`${id} has started downloading.`);
        ping_on_blocking_download(id, function() {
          console.log(`${id} has finished downloading.`);
          resolve();
        });
      }
    });
  }).then(function() {
    on_download_finish(req, res);
    res.send();
  }).catch(function(reason) {
    res.fail(reason);
  });
}

/**
 * Blocks until the audio has been loaded on the server.
 *
 * SUBROUTINE for request_blocking_download() method. 
 *
 * @param  {String}   id       The ID of the video
 * @param  {Function} callback The function to execute about load completion
 */
function ping_on_blocking_download(id, callback) {
  request(`${HEROKU}/alexa/v3/cache/${id}`, function(err, res, body) {
    if (!err) {
      let body_json = JSON.parse(body);
      if (body_json.downloaded) {
        callback();
      } else {
        console.log(`Still downloading. Next ping occurs in ${CACHE_POLLING_INTERVAL} ms.`);
        setTimeout(ping_on_blocking_download, CACHE_POLLING_INTERVAL, id, callback);
      }
    }
  });
}

app.pre = function(req, res, type) {
  if (req.data.session !== undefined) {
    if (req.data.session.application.applicationId !== process.env.ALEXA_APPLICATION_ID) {
      res.fail("Invalid application");
    }
  } else {
    if (req.applicationId !== process.env.ALEXA_APPLICATION_ID) {
      res.fail("Invalid application");
    }
  }
};

app.error = function(exc, req, res) {
  console.error(exc);
  res.say("An error occured: " + exc);
};

app.intent("GetVideoIntent", {
    "slots": {
      "VideoQuery": "VIDEOS"
    },
    "utterances": [
      "search for {-|VideoQuery}",
      "find {-|VideoQuery}",
      "play {-|VideoQuery}",
      "start playing {-|VideoQuery}",
      "put on {-|VideoQuery}"
    ]
  },
  function(req, res) {
    return search_video(req, res, "en-US");
  }
);

app.intent("GetVideoGermanIntent", {
    "slots": {
      "VideoQuery": "VIDEOS"
    },
    "utterances": [
      "suchen nach {-|VideoQuery}",
      "finde {-|VideoQuery}",
      "spielen {-|VideoQuery}",
      "anfangen zu spielen {-|VideoQuery}",
      "anziehen {-|VideoQuery}"
    ]
  },
  function(req, res) {
    return search_video(req, res, "de-DE");
  }
);

app.intent("GetVideoFrenchIntent", {
    "slots": {
      "VideoQuery": "VIDEOS"
    },
    "utterances": [
      "recherche {-|VideoQuery}",
      "cherche {-|VideoQuery}",
      "joue {-|VideoQuery}",
      "met {-|VideoQuery}",
      "lance {-|VideoQuery}",
      "démarre {-|VideoQuery}"
    ]
  },
  function(req, res) {
    return search_video(req, res, "fr-FR");
  }
);

app.intent("GetVideoItalianIntent", {
    "slots": {
      "VideoQuery": "VIDEOS"
    },
    "utterances": [
      "trova {-|VideoQuery}",
      "cerca {-|VideoQuery}",
      "suona {-|VideoQuery}",
      "incomincia a suonare {-|VideoQuery}",
      "metti {-|VideoQuery}"
    ]
  },
  function(req, res) {
    return search_video(req, res, "it-IT");
  }
);

app.intent("AMAZON.YesIntent", function(req, res) {
  let user_id = req.userId;
  if (!buffer_search.hasOwnProperty(user_id) || buffer_search[user_id] == null) {
    res.send();
  } else if (!INTERACTIVE_WAIT) {
    return request_blocking_download(req, res);
  } else {
    if (downloading_users.has(user_id)) {
      return wait_on_interactive_download(req, res);
    } else {
      return request_interactive_download(buffer_search[user_id].id)
        .then(url => {
          downloading_users.add(user_id);
          last_search[user_id] = url;
          return wait_on_interactive_download(req, res);
        })
        .catch(reason => {
          return res.fail(reason);
        });
    }
  }
});

app.intent("AMAZON.NoIntent", function(req, res) {
  let user_id = req.userId;
  buffer_search[user_id] = null;
  res.send();
});

app.audioPlayer("PlaybackFailed", function(req, res) {
  console.error("Playback failed.");
  console.error(req.data.request);
  console.error(req.data.request.error);
});

app.audioPlayer("PlaybackNearlyFinished", function(req, res) {
  let user_id = req.userId;
  let user_wants_repeat = repeat_infinitely.has(user_id) || repeat_once.has(user_id);
  if (user_wants_repeat && has_video(user_id)) {
    let new_token = uuidv4();
    res.audioPlayerPlayStream("ENQUEUE", {
      url: last_search[user_id],
      streamFormat: "AUDIO_MPEG",
      token: new_token,
      expectedPreviousToken: last_token[user_id],
      offsetInMilliseconds: 0
    });
    last_token[user_id] = new_token;
    if (!last_playback.hasOwnProperty(user_id)) {
      last_playback[user_id] = {};
    }
    last_playback[user_id].start = new Date().getTime();
    repeat_once.delete(user_id);
    res.send();
  } else {
    last_token[user_id] = null;
  }
});

app.intent("AMAZON.StartOverIntent", {}, function(req, res) {
  let user_id = req.userId;
  if (has_video(user_id)) {
    restart_video(req, res, 0);
  } else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_REPEAT"]);
  }
  res.send();
});

function stop_intent(req, res) {
  let user_id = req.userId;
  if (has_video(user_id)) {
    if (is_streaming_video(user_id)) {
      last_token[user_id] = null;
      res.audioPlayerStop();
    }
    last_search[user_id] = null;
    res.audioPlayerClearQueue();
  } else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_REPEAT"]);
  }
  res.send();
};

app.intent("AMAZON.StopIntent", {}, stop_intent);
app.intent("AMAZON.CancelIntent", {}, stop_intent);

app.intent("AMAZON.ResumeIntent", {}, function(req, res) {
  let user_id = req.userId;
  if (is_streaming_video(user_id)) {
    restart_video(req, res, last_playback[user_id].stop - last_playback[user_id].start);
  } else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_RESUME"]);
  }
  res.send();
});

app.intent("AMAZON.PauseIntent", {}, function(req, res) {
  let user_id = req.userId;
  if (is_streaming_video(user_id)) {
    if (!last_playback.hasOwnProperty(user_id)) {
      last_playback[user_id] = {};
    }
    last_playback[user_id].stop = new Date().getTime();
    res.audioPlayerStop();
  } else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_RESUME"]);
  }
  res.send();
});

app.intent("AMAZON.RepeatIntent", {}, function(req, res) {
  let user_id = req.userId;
  if (has_video(user_id) && !is_streaming_video(user_id)) {
    restart_video(req, res, 0);
  } else {
    repeat_once.add(user_id);
  }
  res.say(
    response_messages[req.data.request.locale]["REPEAT_TRIGGERED"]
    .formatUnicorn(has_video(user_id) ? "current" : "next")
  ).send();
});

app.intent("AMAZON.LoopOnIntent", {}, function(req, res) {
  let user_id = req.userId;
  repeat_infinitely.add(user_id);
  if (has_video(user_id) && !is_streaming_video(user_id)) {
    restart_video(req, res, 0);
  }
  res.say(
    response_messages[req.data.request.locale]["LOOP_ON_TRIGGERED"]
    .formatUnicorn(has_video(user_id) ? "current" : "next")
  ).send();
});

app.intent("AMAZON.LoopOffIntent", {}, function(req, res) {
  let user_id = req.userId;
  repeat_infinitely.delete(user_id);
  res.say(
    response_messages[req.data.request.locale]["LOOP_OFF_TRIGGERED"]
    .formatUnicorn(has_video(user_id) ? "current" : "next")
  ).send();
});

app.intent("AMAZON.HelpIntent", {}, function(req, res) {
  res.say(response_messages[req.data.request.locale]["HELP_TRIGGERED"]).send();
});

exports.handler = app.lambda();
