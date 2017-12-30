var alexa = require("alexa-app");
var fs = require('fs');
var request = require('request');
var ssml = require('ssml-builder');

var response_strings = require('./responses');

var app = new alexa.app("youtube");

var herokuAppUrl = process.env.HEROKU_APP_URL;
if (!herokuAppUrl || herokuAppUrl === 0) {
  herokuAppUrl = 'https://dmhacker-youtube.herokuapp.com';
}

var lastSearch;
var lastToken;

var lastPlaybackStart;
var lastPlaybackStop;

var repeatEnabled = false;

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

app.pre = function(req, response, type) {
  if (req.data.session !== undefined) {
    if (req.data.session.application.applicationId !== process.env.ALEXA_APPLICATION_ID) {
      response.fail("Invalid application");
    }
  } else {
    if (req.applicationId !== process.env.ALEXA_APPLICATION_ID) {
      response.fail("Invalid application");
    }
  }
};

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
  function(req, response) {
    return get_executable_promise(req, response, 'en-US');
  }
);

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
  function(req, response) {
    return get_executable_promise(req, response, 'de-DE');
  }
);

function get_executable_promise(req, response, language) {
  var query = req.slot("VideoQuery");

  console.log('Searching ... ' + query);

  return new Promise((resolve, reject) => {

    var searchUrl = herokuAppUrl + '/alexa-search/' + new Buffer(query).toString('base64');

    if (language === 'de-DE') {
      searchUrl += '?language=de';
    }

    request(searchUrl, function(err, res, body) {
      if (err) {
        reject(err.message);
      } else {
        var bodyJSON = JSON.parse(body);
        if (bodyJSON.status === 'error' && bodyJSON.message === 'No results found') {
          resolve({
            message: response_strings[language]['NO_RESULTS_FOUND'].formatUnicorn(query),
            url: null,
            metadata: null
          });
        } else {
          console.log('Processing ...');
          lastSearch = herokuAppUrl + bodyJSON.link;
          var metadata = bodyJSON.info;
          lastToken = metadata.id;
          recursive_check(lastToken, 1000, function() {
            console.log('Stored @ ' + lastSearch);
            resolve({
              message: response_strings[language]['NOW_PLAYING'].formatUnicorn(metadata.title),
              url: lastSearch,
              metadata: metadata
            });
          });
        }
      }
    });
  }).then(function(content) {
    var message = content.message;
    var streamUrl = content.url;
    var metadata = content.metadata;
    var speech = new ssml();
    speech.say(message);
    response.say(speech.ssml(true));
    if (streamUrl) {
      response.audioPlayerPlayStream('REPLACE_ALL', {
        'url': streamUrl,
        'streamFormat': 'AUDIO_MPEG',
        'token': metadata.id,
        'offsetInMilliseconds': 0
      });
      response.card({
        'type': 'Simple',
        'title': 'Search for "' + query + '"',
        'content': 'Alexa found "' + metadata.title + '" at ' + metadata.original + '.'
      });
    }
    response.send();
    lastPlaybackStart = new Date().getTime();
  }).catch(function(reason) {
    response.fail(reason);
  });
}

function recursive_check(id, delay, callback) {
  setTimeout(function() {
    request(herokuAppUrl + '/alexa-check/' + id, function(err, res, body) {
      if (!err) {
        if (JSON.parse(body).downloaded) {
          callback();
        }
        else {
          recursive_check(id, delay, callback);
        }
      }
    });
  }, delay);
}

app.audioPlayer("PlaybackStarted", function(req, response) {
  console.log('Playback started.');
});

app.audioPlayer("PlaybackFinished", function(req, response) {
  console.log('Playback finished.');
  if (repeatEnabled && lastSearch) {
    console.log('Repeat was enabled. Playing ' + lastSearch + ' again ...');
    response.audioPlayerPlayStream('REPLACE_ALL', {
      'url': lastSearch,
      'streamFormat': 'AUDIO_MPEG',
      'token': lastToken,
      'offsetInMilliseconds': 0
    });
    lastPlaybackStart = new Date().getTime();
    response.send();
  }
});

app.audioPlayer("PlaybackFailed", function(req, response) {
  console.log('Playback failed.');
  console.log(req.data.request);
  console.log(req.data.request.error);
});

app.intent("AMAZON.PauseIntent", {}, function(req, response) {
  response.audioPlayerStop();
  lastPlaybackStop = new Date().getTime();
  response.send();
});

app.intent("AMAZON.ResumeIntent", {}, function(req, response) {
  if (lastSearch === undefined) {
    response.say(response_strings[req.data.request.locale]['NOTHING_TO_RESUME']);
  } else {
    response.audioPlayerPlayStream('REPLACE_ALL', {
      'url': lastSearch,
      'streamFormat': 'AUDIO_MPEG',
      'token': lastToken,
      'offsetInMilliseconds': lastPlaybackStop - lastPlaybackStart
    });
  }
  response.send();
});

app.intent("AMAZON.RepeatIntent", {}, function(req, response) {
  if (lastSearch === undefined) {
    response.say(response_strings[req.data.request.locale]['NOTHING_TO_REPEAT']);
  } else {
    response.audioPlayerPlayStream('REPLACE_ALL', {
      'url': lastSearch,
      'streamFormat': 'AUDIO_MPEG',
      'token': lastToken,
      'offsetInMilliseconds': 0
    });
    lastPlaybackStart = new Date().getTime();
  }
  response.send();
});

app.intent("AMAZON.LoopOnIntent", {}, function(req, response) {
  console.log('Repeat enabled.');
  repeatEnabled = true;
  response.say(response_strings[req.data.request.locale]['LOOP_ON_TRIGGERED']);
  response.send();
});

app.intent("AMAZON.LoopOffIntent", {}, function(req, response) {
  console.log('Repeat disabled.');
  repeatEnabled = false;
  response.say(response_strings[req.data.request.locale]['LOOP_OFF_TRIGGERED']);
  response.send();
});

app.intent("AMAZON.StopIntent", {}, function(req, response) {
  lastSearch = undefined;
  response.audioPlayerStop();
  response.audioPlayerClearQueue();
  response.send();
});

exports.handler = app.lambda();
