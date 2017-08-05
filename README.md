# alexa-youtube-skill

__DISCLAIMER:__ This skill is not officially supported by YouTube in any way and, as such, will never be published on Amazon. It is more intended as a proof-of-concept, but instructions on setting it up are provided.

By default, Amazon Alexa does not support playing audio from YouTube. In fact, it only supports a limited number of third-party audio-based skills like Spotify music. Otherwise, all default Alexa skills that use audio are tied almost exclusively to Amazon services.

__alexa-youtube-skill__ contains the code for an unpublished skill that allows users to search and play audio from YouTube. For example, a user might say:

"Alexa, search YouTube for Frost Hyperventilate." 

Alexa will then do a search, finding the most relevant video that matches the query (in this case, https://www.youtube.com/watch?v=Ol592sakmZU) and then will return and play the MP3 version of the video.

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
    },
    {
      "intent": "AMAZON.RepeatIntent"
    }
  ]
}
```
Next, in the Sample Utterances section, put this.
```
GetVideoIntent search for {VideoQuery}
GetVideoIntent find {VideoQuery}
GetVideoIntent play {VideoQuery}
GetVideoIntent start playing {VideoQuery}
GetVideoIntent put on {VideoQuery}
```
4b. Note for German users, under Intent Schema, replace "GetVideoIntent" with "GetVideoGermanIntent". Substitute this in replace of the English commands:
```
GetVideoGermanIntent suchen nach {VideoQuery}
GetVideoGermanIntent finde {VideoQuery}
GetVideoGermanIntent spielen {VideoQuery}
GetVideoGermanIntent anfangen zu spielen {VideoQuery}
GetVideoGermanIntent anziehen {VideoQuery}
```
5. Add a custom slot type called VIDEOS. Under "Values", put:
```
prince
the fray
the rolling stones
toad the wet sproket
KC and the sunshine band
john travolta and olivia newton john
DJ jazzy jeff and the fresh prince
lola
hello dolly
love me tender
fools gold
roberta flack killing me softly with his song
stevie wonder superstition
boston
full circle
dubstar
underworld
orbital
let me be your fantasy
pop will eat itself
ultra nate
4 hours Peaceful and Relaxing Instrumental Music
```
6. __Configuration__ page: under Endpoint, select __AWS Lambda ARN (Amazon Resource Name)__ as the Service Endpoint Type. Select North America/Europe depending on where you are. In the field that pops up, leave that blank for now. We will come back to that once the skill has been uploaded to Lambda. Also, under Account Linking, make sure that 'no' is checked.
7. Now it's time to set up Lambda. Log on to your AWS account and select "Lambda" from the main console menu. Make sure your region is set to N. Virginia (North America) or EU-Ireland (Europe). 
8. Click on "Create a Lambda function" in the Lambda console menu. For the blueprint, select __alexa-skills-kit-color-expert__.
9. Configure the function. Give it a name like "alexaYoutubeSkill" and fill in an appropriate description. Assign it to a role with at least S3 read permissions. Leave the rest the default skill for now.
10. Click [here](https://github.com/dmhacker/alexa-youtube-skill/raw/master/alexa-youtube-skill.zip) to download __alexa-youtube-skill.zip__, which contains all the code for the Lambda server. 
      * The zip file is recompiled from this repository ever hour. If you want to verify the build date, open the zip file and look for _timestamp.txt_.
11. Now, go back to the Lambda function you just saved. Under "Code entry type," select "Upload a ZIP file." Then, upload alexa-youtube-skill.zip under "Function Package." 
12. You will now need to enter 2 environment variables. Enter these in:

| Key                  | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| ALEXA_APPLICATION_ID | found under Skill Information under your skill in Amazon Developer  |
| HEROKU_APP_URL       | __OPTIONAL__ the URL for the Heroku intermediary server. Defaults to https://dmhacker-youtube.herokuapp.com if this variable is not included. Otherwise, you can choose to [setup and use your own server](https://github.com/dmhacker/dmhacker-youtube). |
  
13. Additionally, under "Advanced Settings" in your Lambda server, go to the "Timeout" section. Change the timeout duration from 3 seconds to >= 1 minute.
14. The last step is linking your Lambda function to your Alexa skill. Go back to Alexa under Amazon Developer and find your skill. In the __Configuration__ page, put the Lambda ARN name in the blank spot that you left earlier.
15. Go to the __Test__ page and set Enabled to true. The skill will now work exclusively on your devices.

## Technical Details

The way the skill searches, downloads, and fetches the audio is very complicated because it relies on several free utilities. The basic flow of information through the skill could be summarized as this:

Request __(1)__ -> AWS Lambda __(2)__ -> Custom Heroku Server __(3)__ -> User __(4)__

1. The user makes a request mentioning the skill. See the summary for an example.
2. The skill, which is being run on an AWS Lambda server, receives the query.
3. The skill passes that query to [a custom Heroku server that I built](https://github.com/dmhacker/dmhacker-youtube). The Heroku server pulls up the most relevant video on YouTube, downloads the audio into a temporary public folder and returns the link/metadata to the skill.
4. The skill will then send a PlayRequest to the user's Alexa with the link to the MP3 file. 




