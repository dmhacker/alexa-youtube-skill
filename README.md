# alexa-youtube-skill

By default, Amazon Alexa does not support playing audio from YouTube. In fact, it only supports a limited number of third-party audio-based skills like Spotify music. Otherwise, all default Alexa skills that use audio are tied almost exclusively to Amazon services.

__alexa-youtube-skill__ contains the code for an unpublished skill that allows users to search and play audio from YouTube. For example, a user might say:

"Alexa, search YouTube for Frost Hyperventilate." 

Alexa will then do a search, finding the most relevant video that matches the query (in this case, https://www.youtube.com/watch?v=Ol592sakmZU) and then will return and play the MP3 version of the video.

## Technical Details

The way the skill searches, downloads, and fetches the audio is very complicated because it relies on several free utilities. The basic flow of information through the skill could be summarized as this:

Request __(1)__ -> AWS Lambda __(2)__ -> YouTube API __(3)__ -> Custom Heroku Server __(4)__ -> AWS S3 __(5)__ -> User __(6)__

1. The user makes a request mentioning the skill. See the summary for an example.
2. The skill, which is being run on an AWS Lambda server, receives the query.
3. The skill then makes a request to the YouTube API, which then asynchronously returns the YouTube ID of the most relevant video. 
4. Once the skill has the video ID, it sends that to [a custom Heroku server that I built](https://github.com/dmhacker/dmhacker-youtube). The Heroku server takes the video ID, downloads the audio, and puts it into an S3 bucket. 
    * This is by far the most convolunted part of the process. Because the Heroku server is run on a free plan, if it hasn't been used for a while, it has to be woken up. This means that the skill has to block while the server wakes up. I circumvented this problem by setting a large timeout for the skill on the Lambda server.
    * Additionally, the video is downloaded first on the Heroku server as a temporary audio file, and then that file is uploaded to the S3 bucket. This whole process is asynchronous. This means that when the server is notified, the process begins, but the skill's request is returned before the audio file has finished uploading. The skill has to have a way of detecting when the audio file is uploaded because the server has no way of notifying the skill upon completion. I bypassed this issue by having the skill ping the server every 3 seconds, checking to see if the server has uploaded the file. When the server has finished the upload, it will notify the skill when it is pinged, and the skill will return.
5. Even though the download/upload process is asynchronous, the skill will immediately be given a link to the S3 bucket that the audio will be stored in. 
6. When the audio is finished uploading to the bucket, the skill will send a PlayRequest to the user's Alexa with the link to the MP3 file. 

## Setup Process

1. Go on https://developer.amazon.com/ and log in with a developer account. Navigate to the "Alexa" tab and click on "Alexa Skills Kit."
2. Click on "Add Skill." You will be taken to a setup menu. 
3. __Skill Information__ page: give the skill a name you choose. For Invocation Name, put 'youtube' and in the Global Fields section, mark that the skill uses audio player directives.
4. __Interaction Model__ page: put the following under Intent Schema. 
```
{
  "intents": [
    {
      "slots": [
        {
          "name": "VideoQuery",
          "type": "VIDEOS"
        }
      ],
      "intent": "GetVideoIntent"
    },
    {
      "intent": "AMAZON.PauseIntent"
    },
    {
      "intent": "AMAZON.ResumeIntent"
    },
    {
      "intent": "AMAZON.StopIntent"
    }
  ]
}
```
Then, add a custom slot type called VIDEOS. Put some random phrases that you might think might commonly be searched on YouTube under values. Next, in the Sample Utterances section, put this.
```
GetVideoIntent search for {VideoQuery}
GetVideoIntent find {VideoQuery}
GetVideoIntent play {VideoQuery}
GetVideoIntent start playing {VideoQuery}
GetVideoIntent put on {VideoQuery}
```
5. __Configuration__ page: under Endpoint, select __AWS Lambda ARN (Amazon Resource Name)__ as the Service Endpoint Type. Select North America/Europe depending on where you are. In the field that pops up, leave that blank for now. We will come back to that once the skill has been uploaded to Lambda. Also, under Account Linking, make sure that 'no' is checked.
6. We will now be moving on from Amazon Developer and will be setting up the YouTube API. Follow [this guide](https://developers.google.com/youtube/v3/getting-started) to get an API key.
7. Now it's time to set up Lambda. Log on to your AWS account and select "Lambda" from the main console menu. Make sure your region is set to N. Virginia (if you are using your skill in North America). 
8. Click on "Create a Lambda function" in the Lambda console menu. For the blueprint, select __alexa-skills-kit-color-expert__.
9. Configure the function. Give it a name like "alexaYoutubeSkill" and fill in an appropriate description. Assign it to a role with at least S3 read permissions. Leave the rest the default skill for now.
10. Click [here](https://s3-us-west-1.amazonaws.com/alexa-youtube-skill/lambda/alexa-youtube-skill.zip) to download alexa-youtube-skill.zip, which contains all the code for the Lambda server. 
      * The zip file is recompiled from this repository ever hour. If you want to verify the build date, open the zip file and look for _timestamp.txt_.
11. Now, go back to the Lambda function you just saved. Under "Code entry type," select "Upload a ZIP file." Then, upload alexa-youtube-skill.zip under "Function Package." 
12. You will now need to enter 2 environment variables. Enter these in (without the curly braces):
      * key={ALEXA_APPLICATION_ID} | value={found under Skill Information under your skill in Amazon Developer}
      * key={YOUTUBE_API_KEY} | value={the YouTube API key you found earlier}
13. The last step is linking your Lambda function to your Alexa skill. Go back to Alexa under Amazon Developer and find your skill. In the __Configuration__ page, put the Lambda ARN name in the blank spot that you left earlier.
14. Go to the __Test__ page and set Enabled to true. The skill will now work exclusively on your devices.





