var alexa = require("alexa-app");
var search = require('youtube-search');
var ytdl = require('ytdl-core');
var s3 = require('s3');

global.__bucket = process.env.S3_BUCKET;

var app = new alexa.app("youtube");

var s3Client = s3.createClient({
    s3Options: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    }
});

var searchOpts = {
    maxResults: 1,
    type: 'video',
    key: process.env.YOUTUBE_API_KEY
};

var constants = {
    'token': 'string',
    'expectedPreviousToken': 'string'
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
            } else {
                var metadata = results[0];
                if (metadata.link === undefined) {
                    response.say(query + ' did not return any results on YouTube.').send();
                } else {
                    response.say('I found a relevant video called '+metadata.title+'.');

                    var tmpfile = require('path').join('/tmp', metadata.id+'.mp3');
                    var key = require('path').join('audio', metadata.id);

                    var writer = fs.createWriteStream(tmpfile);
                    writer.on('finish', function () {
                        var uploader = s3Client.uploadFile({
                            localFile: tmpfile,
                            s3Params: {
                                Bucket: __bucket,
                                Key: key
                            }
                        });
                        uploader.on('error', function(err) {
                            response.say('I had trouble downloading this video.').send();
                        });
                        uploader.on('end', function() {
                            lastSearch = s3.getPublicUrl(__bucket, key);
                            response.card({
                                'type': 'Simple',
                                'title': metadata.title,
                                'content': metadata.link
                            }).audioPlayerPlayStream('REPLACE_ALL', {
                                'url': lastSearch,
                                'streamFormat': 'AUDIO_MPEG',
                                'token': constants.token,
                                'expectedPreviousToken': constants.expectedPreviousToken
                            }).send();
                        });
                    });

                    ytdl(metadata.link, {
                        filter: function(format) {
                            return format.container === 'mp3';
                        }
                    }).pipe(writer);
                }
            }
        });

        return false;
    }
);

app.intent("AMAZON.PauseIntent", {}, function(request, response) {
    response.audioPlayerStop();
});

app.intent("AMAZON.ResumeIntent", {}, function(request, response) {
    if (lastSearch === undefined) {
        response.say('You were not playing any video previously.');
    } else {
        response.audioPlayerPlayStream('REPLACE_ALL', {
            'url': lastSearch,
            'streamFormat': 'AUDIO_MPEG',
            'token': constants.token,
            'expectedPreviousToken': constants.expectedPreviousToken
        });
    }
});

app.intent("AMAZON.StopIntent", {}, function(request, response) {
    lastSearch = undefined;
    response.audioPlayerStop();
    response.audioPlayerClearQueue();
});

exports.handler = app.lambda();
