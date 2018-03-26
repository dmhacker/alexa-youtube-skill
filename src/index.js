// Enables Python-esque formatting
// (e.g. "Hello {0}!".formatUnicorn("world") => "Hello world!")
String.prototype.formatUnicorn = String.prototype.formatUnicorn || function () {
  "use strict";
  var str = this.toString();
  if (arguments.length) {
    var t = typeof arguments[0];
    var key;
    var args = ("string" === t || "number" === t) ?
      Array.prototype.slice.call(arguments)
      : arguments[0];

    for (key in args) {
      str = str.replace(new RegExp("\\{" + key + "\\}", "gi"), args[key]);
    }
  }
  return str;
};

// Required packages
var alexa = require("alexa-app");
var fs = require('fs');
var request = require('request');
var ssml = require('ssml-builder');
var response_messages = require('./responses');

// Create Alexa skill application
var app = new alexa.app("youtube");

// Set Heroku URL
var heroku = process.env.HEROKU_APP_URL || 'https://dmhacker-youtube.herokuapp.com';

// The URL and video ID that was last searched & their corresponding stream token
var last_search = {
  url: undefined,
  id: undefined
}
var last_token;

// Playback information
var last_playback = {
  start: undefined,
  stop: undefined
};

// Current song is repeating
var repeat_infinitely = false;
var repeat_once = false;

/**
 * Generates a random UUID. Used for creating an audio stream token.
 *
 * @return {String} A random globally unique UUID
 */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Restarts the video by injecting the last search URL as a new stream.
 *
 * @param  {Object} res    A response that will be sent to the Alexa device
 * @param  {Number} offset How many milliseconds from the video start to begin at
 */
function restart_last_video(res, offset) {
    // Generate new token
    last_token = uuidv4();

    // Replay the last searched audio back into Alexa
    res.audioPlayerPlayStream('REPLACE_ALL', {
      url: last_search.url,
      streamFormat: 'AUDIO_MPEG',
      token: last_token,
      offsetInMilliseconds: offset
    });

    // Record playback start time
    last_playback.start = new Date().getTime();
}

/**
 * Downloads the YouTube video audio via a Promise.
 *
 * @param  {Object} req  A request from an Alexa device
 * @param  {Object} res  A response that will be sent to the device
 * @param  {String} lang The language of the query
 * @return {Promise} Execution of the request
 */
function get_video(req, res, lang) {
  var query = req.slot("VideoQuery");

  console.log('Searching ... ' + query);

  return new Promise((resolve, reject) => {
    var search = heroku + '/alexa-search/' + new Buffer(query).toString('base64');

    // Add German to search query depending on the intent used
    if (lang === 'de-DE')
      search += '?language=de';

    // Make request to download server
    request(search, function(err, res, body) {
      if (err) {
        // Error in the request
        reject(err.message);
      } else {
        // Convert body text in response to JSON object
        var body_json = JSON.parse(body);
        if (body_json.status === 'error' && body_json.message === 'No results found') {
          // Query did not return any video
          resolve({
            message: response_messages[lang]['NO_RESULTS_FOUND'].formatUnicorn(query),
            url: null,
            metadata: null
          });
        } else {
          // Set last search & token to equal the current video's parameters
          var metadata = body_json.info;
          last_search.url = heroku + body_json.link;
          last_search.id = metadata.id;
          last_token = uuidv4();

          console.log('YouTube URL: ' + metadata.original);

          wait_for_video(metadata.id, function() {
            console.log('Audio URL: ' + last_search.url);

            // Return audio URL from request to promise
            resolve({
              message: response_messages[lang]['NOW_PLAYING'].formatUnicorn(metadata.title),
              url: last_search.url,
              metadata: metadata
            });
          });
        }
      }
    });

  }).then(function(content) {
    // Have Alexa say the message fetched from the Heroku server
    var speech = new ssml();
    speech.say(content.message);
    res.say(speech.ssml(true));

    if (content.url) {
      // Generate card for the Alexa mobile app
      var metadata = content.metadata;
      res.card({
        type: 'Simple',
        title: 'Search for "' + query + '"',
        content: 'Alexa found "' + metadata.title + '" at ' + metadata.original + '.'
      });

      // Start playing the video!
      restart_last_video(res, 0);
    }

    // Send response to Alexa device
    res.send();
  }).catch(function(reason) {
    // Error in promise
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
  setTimeout(function() {
    request(heroku + '/alexa-check/' + id, function(err, res, body) {
      if (!err) {
        var body_json = JSON.parse(body);
        if (body_json.downloaded) {
          callback();
        }
        else {
          wait_for_video(id, callback);
        }
      }
    });
  }, 2000);
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
      "VideoQuery": "VIDEOS",
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
    return get_video(req, res, 'en-US');
  }
);

// Looking up a video in German
app.intent("GetVideoGermanIntent", {
    "slots": {
      "VideoQuery": "VIDEOS",
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
    return get_video(req, res, 'de-DE');
  }
);

// Log playback started events
app.audioPlayer("PlaybackStarted", function(req, res) {
  console.log('Playback started.');
});

// Log playback failed events
app.audioPlayer("PlaybackFailed", function(req, res) {
  console.error('Playback failed.');
  console.error(req.data.request);
  console.error(req.data.request.error);
});

// Use playback finished events to repeat audio
app.audioPlayer("PlaybackNearlyFinished", function(req, res) {
  console.log('Playback nearbly finished.');

  // Repeat is enabled, so begin next playback
  if (last_search.url && (repeat_infinitely || repeat_once)) {
    console.log('Repeat was enabled. Playing ' + last_search.url + ' again ...');

    // Generate new token for the stream
    var new_token = uuidv4();

    // Inject the audio that was just playing back into Alexa
    res.audioPlayerPlayStream('ENQUEUE', {
      url: last_search.url,
      streamFormat: 'AUDIO_MPEG',
      token: new_token,
      expectedPreviousToken: last_token,
      offsetInMilliseconds: 0
    });

    // Set last token to new token
    last_token = new_token;

    // Record playback start time
    last_playback.start = new Date().getTime();

    // We repeated the video, so singular repeat is set to false
    repeat_once = false;

    // Send response to Alexa device
    res.send();
  }
  else {
    // Token is set to undefined because playback is done
    last_token = undefined;
  }
});

// User told Alexa to resume the audio
app.intent("AMAZON.ResumeIntent", {}, function(req, res) {
  if (last_token == undefined) {
    res.say(response_messages[req.data.request.locale]['NOTHING_TO_RESUME']);
  }
  else {
    // Replay the video starting at the desired offset
    restart_last_video(res, last_playback.stop - last_playback.start);
  }
  res.send();
});

// User told Alexa to pause the audio
app.intent("AMAZON.PauseIntent", {}, function(req, res) {
  if (last_token == undefined) {
    res.say(response_messages[req.data.request.locale]['NOTHING_TO_RESUME']);
  }
  else {
    // Stop the video and record the timestamp
    last_playback.stop = new Date().getTime();
    res.audioPlayerStop();
  }
  res.send();
});

// User told Alexa to start over the audio
app.intent("AMAZON.StartOverIntent", {}, function(req, res) {
  if (last_search.url == undefined) {
    res.say(response_messages[req.data.request.locale]['NOTHING_TO_REPEAT']);
  }
  else {
    // Replay the video from the beginning
    restart_last_video(res, 0);
  }
  res.send();
});

// User told Alexa to stop playing audio
app.intent("AMAZON.StopIntent", {}, function(req, res) {
  if (last_search.url == undefined) {
    res.say(response_messages[req.data.request.locale]['NOTHING_TO_REPEAT']);
  }
  else {
    // Clear search and token
    last_search.url = undefined;
    last_search.id = undefined;
    last_token = undefined;

    // Stop the audio player and clear the queue
    res.audioPlayerStop();
    res.audioPlayerClearQueue("REPLACE_ALL");
  }
  res.send();
});

// User told Alexa to repeat audio infinitely
app.intent("AMAZON.RepeatIntent", {}, function(req, res) {
  // User searched for a video but playback ended
  if (last_token == undefined && last_search.url)
    restart_last_video(res, 0);
  else
    repeat_once = true;

  res.say(
    response_messages[req.data.request.locale]['REPEAT_TRIGGERED']
      .formatUnicorn(last_search.url != undefined ? 'current' : 'next')
  ).send();
});

// User told Alexa to repeat audio infinitely
app.intent("AMAZON.LoopOnIntent", {}, function(req, res) {
  // Enable repeating infinitely
  repeat_infinitely = true;

  // User searched for a video but playback ended
  if (last_token == undefined && last_search.url)
    restart_last_video(res, 0);

  res.say(
    response_messages[req.data.request.locale]['LOOP_ON_TRIGGERED']
      .formatUnicorn(last_search.url != undefined ? 'current' : 'next')
  ).send();
});

// User told Alexa to stop repeating audio infinitely
app.intent("AMAZON.LoopOffIntent", {}, function(req, res) {
  repeat_infinitely = false;
  res.say(
    response_messages[req.data.request.locale]['LOOP_OFF_TRIGGERED']
      .formatUnicorn(last_search.url != undefined ? 'current' : 'next')
  ).send();
});

exports.handler = app.lambda();