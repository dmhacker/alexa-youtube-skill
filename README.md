# alexa-youtube-skill

By default, Amazon Alexa does not support playing audio from YouTube. In fact, it only supports a limited number of third-party audio-based skills like Spotify music. Otherwise, all default Alexa skills that use audio are tied almost exclusively to Amazon services.

__alexa-youtube-skill__ contains the code for an unpublished skill that allows users to search and play audio from YouTube. For example, a user might say:

"Alexa, search YouTube for Frost Hyperventilate." 

Alexa will then do a search, finding the most relevant video that matches the query (in this case, https://www.youtube.com/watch?v=Ol592sakmZU) and then will return and play the MP3 version of the video.

## Technical Details

The way the skill searches, downloads, and fetches the audio is very complicated because it relies on several free utilities. The basic flow of information through the skill could be summarized as this:

Request (1) --> AWS Lambda (2) --> YouTube API (3) --> Custom Heroku Server (4) --> AWS S3 (5) --> User (6)

1. The user makes a request mentioning the skill. See the summary for an example.
2. The skill, which is being run on an AWS Lambda server, receives the query.
3. The skill then makes a request to the YouTube API, which then asynchronously returns the YouTube ID of the most relevant video. 
4. Once the skill has the video ID, it sends that [a custom Heroku server that I built](https://github.com/dmhacker/dmhacker-youtube). The Heroku server takes the video ID, downloads the audio, and puts it into an S3 bucket. 
    * This is by far the most convolunted part of the process. Because the Heroku server is run on a free plan, if it hasn't been used for a while, it has to be woken up. This means that the skill has to block while the server wakes up. I circumvented this problem by setting a large timeout for the skill on the Lambda server.
    * Additionally, the video is downloaded first on the Heroku server as a temporary audio file, and then that file is uploaded to the S3 bucket. This whole process is asynchronous. This means that when the server is notified, the process begins, but the skill's request is returned before the audio file has finished uploading. The skill has to have a way of detecting when the audio file is uploaded because the server has no way of notifying the skill upon completion. I bypassed this issue by having the skill ping the server every 3 seconds, checking to see if the server has uploaded the file. When the server has finished the upload, it will notify the skill when it is pinged, and the skill will return.
5. Even though the download/upload process is asynchronous, the skill will immediately be given a link to the S3 bucket that the audio will be stored in. 
6. When the audio is finished uploading to the bucket, the skill will send a PlayRequest to the user's Alexa with the link to the MP3 file. 

## Setup Process

WIP




