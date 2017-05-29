var alexa = require("alexa-app");
var search = require('youtube-search');
var fs = require('fs');
var request = require('request');

var app = new alexa.app("youtube");

var searchOpts = {
    maxResults: 1,
    type: 'video',
    key: process.env.YOUTUBE_API_KEY
};

var lastSearch;

app.pre = function(req, response, type) {
    if (req.sessionDetails.application.applicationId !== process.env.ALEXA_APPLICATION_ID) {
        response.fail("Invalid application");
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
        var query = req.slot("VideoQuery");

        console.log('Searching ... ' + query);

        search(query, searchOpts, function(err, results) {
            if (err) {
                response.fail(err.message);
            } else if (results.length !== 1) {
                response.say('I could not complete your request at this moment.').send();
            } else {
                var metadata = results[0];
                if (metadata.id === undefined) {
                    response.say(query + ' did not return any results on YouTube.').send();
                } else {
                    response.say('I found a relevant video called ' + metadata.title + '.');

                    console.log('Found ... ' + metadata.title);

                    var id = metadata.id;
                    var externalDownload = 'https://dmhacker-youtube.herokuapp.com/alexa/' + id;

                    request(externalDownload, function(err, res, body) {
                        console.log('Processed.');

                        if (err) {
                            console.log(err);
                            console.log(body);
                            response.fail(err.message);
                        } else {
                            recursive_check(id, 1000, function(err) {
                                if (err) {
                                    response.fail(err.message);
                                }
                                else {
                                    lastSearch = JSON.parse(body).link;
                                    var stream = {
                                        'url': lastSearch,
                                        'token': metadata.id,
                                        'offsetInMilliseconds': 0
                                    };
                                    response.audioPlayerPlayStream('ENQUEUE', stream);
                                    response.card({
                                        'type': 'Simple',
                                        'title': 'Search for "' + query + '"',
                                        'content': 'Alexa found "' + metadata.title + '" at ' + metadata.link + '.'
                                    });
                                    response.send();
                                }
                            });
                        }
                    });
                }
            }
        });

        return false;
    }
);

function recursive_check(id, delay, callback) {
    var linkCheck = 'https://dmhacker-youtube.herokuapp.com/alexa-check/' + id;
    request(linkCheck, function (err, res, body) {
        if (err) {
            callback(err);
        }
        else {
            var metadata = JSON.parse(body).metadata;
            if (!metadata) {
                callback(err);
            }
            else {
                if (metadata.downloaded) {
                    callback(null);
                }
                else {
                    setTimeout(function () {
                        recursive_check(id, delay, callback);
                    }, delay);
                }
            }
        }
    });
}

app.audioPlayer("PlaybackStarted", function(request, response) {
    console.log('Now playing audio clip ...');
    console.dir(request);
});

app.intent("AMAZON.PauseIntent", {}, function(req, response) {
    response.audioPlayerStop();
});

app.intent("AMAZON.ResumeIntent", {}, function(req, response) {
    if (lastSearch === undefined) {
        response.say('You were not playing any video previously.');
    } else {
        response.audioPlayerPlayStream('ENQUEUE', {
            'url': lastSearch,
            'streamFormat': 'AUDIO_MPEG',
            'token': constants.token,
            'expectedPreviousToken': constants.expectedPreviousToken
        });
    }
});

app.intent("AMAZON.StopIntent", {}, function(req, response) {
    lastSearch = undefined;
    response.audioPlayerStop();
    response.audioPlayerClearQueue();
});

exports.handler = app.lambda();
