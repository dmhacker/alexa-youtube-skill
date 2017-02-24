
var alexa = require("alexa-app");
var search = require('youtube-search');
var ytdl = require('ytdl-core');

var app = new alexa.app("youtube");

var searchOpts = {
    maxResults: 1,
    type: 'video',
    key: process.env.YOUTUBE_API_KEY
};

var lastSearch;

app.pre = function(request, response, type) {
    if (request.applicationId != "amzn1.ask.skill.e252ffe0-987b-43c2-abec-58050fd7153b") {
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
    function(request, response) {
        var query = request.slot("VideoQuery");

        search(query, searchOpts, function(err, results) {
            if (err || results.length !== 1) {
                response.say('I could not complete your request at this moment.').send();
            }
            else {
                var metadata = results[0];
                if (metadata.id === undefined) {
                    response.say(query+' did not return any results on YouTube.').send();
                }
                else {
                    lastSearch = metadata.id;

                    var prefix = 'https://dmhacker-youtube.herokuapp.com';
                    var options = {
                        hostname: prefix,
                        path: '/target/'+lastSearch,
                        method: 'GET',
                        json: true
                    };
                    request(options, function(err, response, body){
                        if(err) {
                            console.log(error);
                            response.say('I could not complete your request at this moment.').send();
                        }
                        else {
                            response.say('I have found a video related to '+query+' on YouTube.');
                            var streamdata = JSON.parse(body);
                            var stream = {
                                "url": prefix+streamdata.link,
                                "token": "aToken",
                                "expectedPreviousToken": "aToken",
                                "offsetInMilliseconds": 0
                            };
                            response.audioPlayerPlayStream('REPLACE_ALL', stream).send();
                        }
                    });
                }
            }
        });

        return false;
    }
);

app.intent("AMAZON.PauseIntent", {}, function (request, response) {
    response.audioPlayerStop();
});

app.intent("AMAZON.ResumeIntent", {}, function (request, response) {
    if (lastSearch !== undefined) {
        response.say('You were not playing any video previously.');
    }
    else {
        var stream = ytdl(lastSearch, {
            filter: function(format) {
                return format.container === 'mp3';
            }
        });
        response.audioPlayerPlayStream('REPLACE_ALL', stream);
    }
});

app.intent("AMAZON.StopIntent", {}, function (request, response) {
    response.audioPlayerStop();
    response.audioPlayerClearQueue();
});

exports.handler = app.lambda();
