"use strict";

// Setup Python-esque formatting
String.prototype.formatUnicorn = String.prototype.formatUnicorn || require("./util/formatting.js");

// Required packages
var alexa = require("alexa-app");
var request = require("request");
var ssml = require("ssml-builder");
var response_messages = require("./util/responses.js");
response_messages['en-GB'] = response_messages['en-US'];

// Create Alexa skill application
var app = new alexa.app("youtube");

// Set Heroku URL
const heroku = process.env.HEROKU_APP_URL || "https://dmhacker-youtube.herokuapp.com";

const interactive_wait = process.env.INTERACTIVE_WAIT == "true";
const cache_polling_interval = parseInt(process.env.CACHE_POLLING_INTERVAL || "10000", 10);
const alexa_request_timeout = parseInt(process.env.ALEXA_REQUEST_TIMEOUT || "45000", 10);

// Variables relating to videos waiting for user input
var buffer_search = {};

// Variables relating to the last video searched
var last_search = {};
var last_token = {};
var last_playback = {};

// Variables for repetition of current song
var repeat_infinitely = {};
var repeat_once = {};

// To track whether downloading is already in progress
var downloading = false;

/**
 * Generates a random UUID. Used for creating an audio stream token.
 *
 * @return {String} A random globally unique UUID
 */
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Returns whether a user is streaming video or not.
 * By default, if this is true, then the user also has_video() as well.
 *
 * @return {Boolean} The state of the user's audio stream
 */
function is_streaming_video(userId) {
  return last_token.hasOwnProperty(userId) && last_token[userId] != null;
}

/**
 * Returns whether a user has downloaded a video.
 * Doesn't take into account if the user is currently playing it.
 *
 * @return {Boolean} The state of the user's audio reference
 */
function has_video(userId) {
  return last_search.hasOwnProperty(userId) && last_search[userId] != null;
}

/**
 * Restarts the video by injecting the last search URL as a new stream.
 *
 * @param  {Object} res    A response that will be sent to the Alexa device
 * @param  {Number} offset How many milliseconds from the video start to begin at
 */
function restart_video(req, res, offset) {
  var userId = req.userId;

  // Generate new token
  last_token[userId] = uuidv4();

  // Replay the last searched audio back into Alexa
  res.audioPlayerPlayStream("REPLACE_ALL", {
    url: last_search[userId],
    streamFormat: "AUDIO_MPEG",
    token: last_token[userId],
    offsetInMilliseconds: offset
  });

  // Record playback start time
  if (!last_playback.hasOwnProperty(userId)) {
    last_playback[userId] = {};
  }
  last_playback[userId].start = new Date().getTime();
}

/**
 * Searches a YouTube video matching the user's query.
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 * @return {Promise} Execution of the request
 */
function search_video(req, res, lang) {
  var userId = req.userId;

  var query = req.slot("VideoQuery");
  console.log("Requesting search ... " + query);

  return new Promise((resolve, reject) => {
    var search = heroku + "/alexa/v3/search/" + new Buffer(query).toString("base64");

    // Populate URL with correct language
    if (lang === "de-DE") {
      search += "?language=de";
    } else if (lang === "fr-FR") {
      search += "?language=fr";
    } else if (lang === "it-IT") {
      search += "?language=it";
    }

    // Make search request to server
    request(search, function(err, res, body) {
      if (err) {
        // Error in the request
        reject(err.message);
      } else {
        // Convert body text in response to JSON object
        var body_json = JSON.parse(body);
        if (body_json.status === "error" && body_json.message === "No results found") {
          // Query did not return any video
          resolve({
            message: response_messages[lang]["NO_RESULTS_FOUND"].formatUnicorn(query),
            metadata: null
          });
        } else {
          // Extract and return metadata
          var metadata = body_json.video;
          console.log("Found ... " + metadata.title + " @ " + metadata.link);
          resolve({
            message: response_messages[lang]["ASK_TO_PLAY"].formatUnicorn(metadata.title),
            metadata: metadata
          });
        }
      }
    });
  }).then(function(content) {
    // Have Alexa say the message fetched from the Heroku server
    var speech = new ssml();
    speech.say(content.message);
    res.say(speech.ssml(true));

    if (content.metadata) {
      var metadata = content.metadata;

      // Generate card for the Alexa mobile app
      res.card({
        type: "Simple",
        title: "Search for \"" + query + "\"",
        content: "Alexa found \"" + metadata.title + "\" at " + metadata.link + "."
      });

      // Set most recently searched for video
      buffer_search[userId] = metadata;
      downloading = false;

      res.reprompt().shouldEndSession(false);
    }

    // Send response to Alexa device
    res.send();
  }).catch(function(reason) {
    // Error occurred in the promise
    res.fail(reason);
  });
}

function make_download_video_request(id) {
  return new Promise((resolve, reject) => {
    request(heroku + "/alexa/v3/download/" + id, function(err, res, body) {
      if (err) {
        console.error(err.message);
        reject(err.message);
      } else {
        var body_json = JSON.parse(body);
        var url = heroku + body_json.link;
        console.log("Requested downloading for ... " + url);
        resolve(url);
      }
    });
  });
}

function check_cache_ready(id, timeout) {
  return new Promise((resolve, reject) => {
      request(heroku + "/alexa/v3/cache/" + id, function(err, res, body) {
      if (!err) {
        var body_json = JSON.parse(body);
        if (body_json.hasOwnProperty('downloaded') && body_json['downloaded'] != null) {
          if (body_json.downloaded) {
            downloading = false;
            console.log(id + " ready in the cache!");
            resolve();
          }
          else {
            downloading = true;
            console.log(id + " being cached atm.");
            if (timeout <= 0) {
              resolve();
              return;
            }
            var interval = Math.min(cache_polling_interval, timeout);
            console.log("Will check again in " + interval + "ms (timeout: " + timeout + "ms).");
            resolve(new Promise((_resolve) => {
              setTimeout(() => {
                _resolve(check_cache_ready(id, timeout - cache_polling_interval));
              }, interval);
            }));
          }
        }
        else {
          console.log(id + " never cached yet.");
          reject("Video unavailable");
        }
      }
      else {
        console.error(err.message);
        reject(err.message);
      }
    });
  });
}

function respond_play(req, res) {
  var userId = req.userId;
  var speech = new ssml();
  var title = buffer_search[userId].title;
  var message = response_messages[req.data.request.locale]["NOW_PLAYING"].formatUnicorn(title);
  speech.say(message);
  res.say(speech.ssml(true));

  console.log("Start playing ... " + title);
  // Start playing the video!
  restart_video(req, res, 0);
}

/**
 * Downloads the mostly recent video the user requested.
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @return {Promise} Execution of the request
 */
function download_video(req, res) {
  var userId = req.userId;

  var id = buffer_search[userId].id;
  console.log("Requesting download ... " + id);

  return new Promise((resolve, reject) => {
    var download = heroku + "/alexa/v3/download/" + id;

    // Make download request to server
    request(download, function(err, res, body) {
      if (err) {
        // Error in the request
        reject(err.message);
      } else {
        // Convert body text in response to JSON object
        var body_json = JSON.parse(body);

        // Set last search & token to equal the current video's parameters
        last_search[userId] = heroku + body_json.link;

        // MX: Not convinced this should be necessary ...
        // NOTE: this is somewhat of hack to get Alexa to ignore an errant PlaybackNearlyFinished event
        // repeat_once[userId] = true;
        // repeat_infinitely[userId] = false;

        // Wait until video is downloaded by repeatedly pinging cache
        console.log("Waiting for ... " + last_search[userId]);
        wait_for_video(id, function() {
          console.log(last_search[userId] + " has finished downloading.");
          resolve();
        });
      }
    });
  }).then(function() {
    // Have Alexa tell the user that the video is finished downloading
    respond_play(req, res);

    // Send response to Alexa device
    res.send();
  }).catch(function(reason) {
    // Error occurred in the promise
    res.fail(reason);
  });
}

/**
 * Blocks until the audio has been loaded on the server.
 *
 * @param  {String}   id       The ID of the video
 * @param  {Function} callback The function to execute about load completion
 */
function wait_for_video(id, callback) {
  request(heroku + "/alexa/v3/cache/" + id, function(err, res, body) {
    if (!err) {
      var body_json = JSON.parse(body);
      if (body_json.downloaded) {
        callback();
      }
      else {
        setTimeout(wait_for_video, cache_polling_interval, id, callback);
      }
    }
  });
}

// Filter out bad requests (the client's ID is not the same as the server's)
app.pre = function(req, res, type) {
  if (req.data.session !== undefined) {
    if (req.data.session.application.applicationId !== process.env.ALEXA_APPLICATION_ID) {
      res.fail("Invalid application");
    }
  }
  else {
    if (req.applicationId !== process.env.ALEXA_APPLICATION_ID) {
      res.fail("Invalid application");
    }
  }
};

// Looking up a video in English
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

// Looking up a video in German
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

// Looking up a video in French
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

// Looking up a video in Italian
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

function interactively_wait_for_video(req, res) {
  var userId = req.userId;
  var id = buffer_search[userId].id;
  return check_cache_ready(id, alexa_request_timeout).then(() => {
    if (!downloading) {
      respond_play(req, res);
    }
    else {
      console.log("Asking whether to continue waiting ...");
      var message = "Download still in progress. Would you like to keep waiting?";
      var speech = new ssml();
      speech.say(message);
      res.say(speech.ssml(true));
      res.reprompt(message).shouldEndSession(false);
    }
    res.send();
  }).catch(reason => {
    res.fail(reason);
  });
}

app.intent("AMAZON.YesIntent", function(req, res) {
  var userId = req.userId;

  if (!buffer_search.hasOwnProperty(userId) || buffer_search[userId] == null) {
    res.send();
  }
  else if (!interactive_wait) {
    return download_video(req, res);
  }
  else {
    var id = buffer_search[userId].id;
    if (!downloading) {
      return make_download_video_request(id)
      .then(url => {
        downloading = true;
        last_search[userId] = url;
        return interactively_wait_for_video(req, res);
      })
      .catch(reason => {
        res.fail(reason);
      });
    }
    return interactively_wait_for_video(req, res);
  }
});

app.intent("AMAZON.NoIntent", function(req, res) {
  var userId = req.userId;
  buffer_search[userId] = null;
  res.send();
});

// Log playback failed events
app.audioPlayer("PlaybackFailed", function(req, res) {
  console.error("Playback failed.");
  console.error(req.data.request);
  console.error(req.data.request.error);
});

// Use playback finished events to repeat audio
app.audioPlayer("PlaybackNearlyFinished", function(req, res) {
  var userId = req.userId;

  // Repeat is enabled, so begin next playback
  if (has_video(userId) &&
    ((repeat_infinitely.hasOwnProperty(userId) && repeat_infinitely[userId]) ||
    (repeat_once.hasOwnProperty(userId) && repeat_once[userId])))
  {
    // Generate new token for the stream
    var new_token = uuidv4();

    // Inject the audio that was just playing back into Alexa
    res.audioPlayerPlayStream("ENQUEUE", {
      url: last_search[userId],
      streamFormat: "AUDIO_MPEG",
      token: new_token,
      expectedPreviousToken: last_token[userId],
      offsetInMilliseconds: 0
    });

    // Set last token to new token
    last_token[userId] = new_token;

    // Record playback start time
    if (!last_playback.hasOwnProperty(userId)) {
      last_playback[userId] = {};
    }
    last_playback[userId].start = new Date().getTime();

    // We repeated the video, so singular repeat is set to false
    repeat_once[userId] = false;

    // Send response to Alexa device
    res.send();
  }
  else {
    // Token is set to null because playback is done
    last_token[userId] = null;
  }
});

// User told Alexa to start over the audio
app.intent("AMAZON.StartOverIntent", {}, function(req, res) {
  var userId = req.userId;

  if (has_video(userId)) {
    // Replay the video from the beginning
    restart_video(req, res, 0);
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_REPEAT"]);
  }

  res.send();
});

var stop_intent = function(req, res) {
  var userId = req.userId;

  if (has_video(userId)) {
    // Stop current stream from playing
    if (is_streaming_video(userId)) {
      last_token[userId] = null;
      res.audioPlayerStop();
    }

    // Clear the entire stream queue
    last_search[userId] = null;
    res.audioPlayerClearQueue();
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_REPEAT"]);
  }

  res.send();
};

// User told Alexa to stop playing audio
app.intent("AMAZON.StopIntent", {}, stop_intent);
app.intent("AMAZON.CancelIntent", {}, stop_intent);

// User told Alexa to resume the audio
app.intent("AMAZON.ResumeIntent", {}, function(req, res) {
  var userId = req.userId;

  if (is_streaming_video(userId)) {
    // Replay the video starting at the desired offset
    restart_video(req, res, last_playback[userId].stop - last_playback[userId].start);
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_RESUME"]);
  }

  res.send();
});

// User told Alexa to pause the audio
app.intent("AMAZON.PauseIntent", {}, function(req, res) {
  var userId = req.userId;

  if (is_streaming_video(userId)) {
    // Stop the video and record the timestamp
    if (!last_playback.hasOwnProperty(userId)) {
      last_playback[userId] = {};
    }
    last_playback[userId].stop = new Date().getTime();
    res.audioPlayerStop();
  }
  else {
    res.say(response_messages[req.data.request.locale]["NOTHING_TO_RESUME"]);
  }

  res.send();
});

// User told Alexa to repeat audio once
app.intent("AMAZON.RepeatIntent", {}, function(req, res) {
  var userId = req.userId;

  // User searched for a video but playback ended
  if (has_video(userId) && !is_streaming_video(userId)) {
    restart_video(req, res, 0);
  }
  else {
    repeat_once[userId] = true;
  }

  res.say(
    response_messages[req.data.request.locale]["REPEAT_TRIGGERED"]
      .formatUnicorn(has_video(userId) ? "current" : "next")
  ).send();
});

// User told Alexa to repeat audio infinitely
app.intent("AMAZON.LoopOnIntent", {}, function(req, res) {
  var userId = req.userId;

  repeat_infinitely[userId] = true;

  // User searched for a video but playback ended
  if (has_video(userId) && !is_streaming_video(userId)) {
    restart_video(req, res, 0);
  }

  res.say(
    response_messages[req.data.request.locale]["LOOP_ON_TRIGGERED"]
      .formatUnicorn(has_video(userId) ? "current" : "next")
  ).send();
});

// User told Alexa to stop repeating audio infinitely
app.intent("AMAZON.LoopOffIntent", {}, function(req, res) {
  var userId = req.userId;

  repeat_infinitely[userId] = false;

  res.say(
    response_messages[req.data.request.locale]["LOOP_OFF_TRIGGERED"]
      .formatUnicorn(has_video(userId) ? "current" : "next")
  ).send();
});

// User asked Alexa for help
app.intent("AMAZON.HelpIntent", {}, function(req, res) {
  res.say(response_messages[req.data.request.locale]["HELP_TRIGGERED"]).send();
});

exports.handler = app.lambda();
