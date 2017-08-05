var alexa = require("alexa-app");
var fs = require('fs');
var request = require('request');

var app = new alexa.app("youtube");

var herokuAppUrl = process.env.HEROKU_APP_URL;
if (!herokuAppUrl || herokuAppUrl === 0) {
  herokuAppUrl = 'https://dmhacker-youtube.herokuapp.com';
}

var lastSearch;
var lastToken;

var lastPlaybackStart;
var lastPlaybackStop;

app.pre = function(req, response, type) {
    if (req.data.session !== undefined) {
        if (req.data.session.application.applicationId !== process.env.ALEXA_APPLICATION_ID) {
            response.fail("Invalid application");
        }
    }
    else {
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
        return get_executable_promise(req, response, 'english');
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
        return get_executable_promise(req, response, 'german');
    }
);

function get_executable_promise(req, response, language) {
    var query = req.slot("VideoQuery");

    console.log('Searching ... ' + query);

    return new Promise((resolve, reject) => {

      request(herokuAppUrl + '/alexa-search/' + new Buffer(query).toString('base64'), function(err, res, body) {
          if (err) {
              reject(err.message);
          } else {
            var bodyJSON = JSON.parse(body);
            if (bodyJSON.status === 'error' && bodyJSON.message === 'No results found') {
                resolve({
                    message: language === 'german' ? 'Keine Ergebnisse auf Youtube gefunden.' : query + ' did not return any results on YouTube.',
                    url: null,
                    metadata: null
                });
            }
            else {
                lastSearch = herokuAppUrl + bodyJSON.link;
                console.log('Stored @ '+lastSearch);
                var metadata = bodyJSON.info;
                lastToken = metadata.id;
                resolve({
                    message: language === 'german' ? 'Ich spiele jetzt ' + metadata.title + '.' : 'I am now playing ' + metadata.title + '.',
                    url: lastSearch,
                    metadata: metadata
                });
            }
          }
      });
    }).then(function (content) {
        var message = content.message;
        var streamUrl = content.url;
        var metadata = content.metadata;
        response.say(message);
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

app.audioPlayer("PlaybackStarted", function(req, response) {
    console.log('Playback started.');
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
        response.say(req.data.request.locale === 'de-DE' ? 'Sie spielen derzeit nichts.' : 'You are not playing anything currently.');
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

app.intent("AMAZON.StopIntent", {}, function(req, response) {
    lastSearch = undefined;
    response.audioPlayerStop();
    response.audioPlayerClearQueue();
    response.send();
});

app.intent("AMAZON.RepeatIntent", {}, function(req, response) {
    if (lastSearch === undefined) {
        response.say(req.data.request.locale === 'de-DE' ? 'Sie haben vorher kein Video gespielt.' : 'You were not playing any video previously.');
    } else {
        response.audioPlayerPlayStream('REPLACE_ALL', {
            'url': lastSearch,
            'streamFormat': 'AUDIO_MPEG',
            'token': lastToken,
            'offsetInMilliseconds': 0
        });
    }
    response.send();
})

exports.handler = app.lambda();
