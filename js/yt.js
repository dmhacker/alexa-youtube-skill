var search = require('youtube-search');

var opts = {
    maxResults: 1,
    type: 'video',
    key: 'AIzaSyB95LHUOMSkNcvlJAyG5NwUiBQ88B_WXSw'
};

search('deadmau5', opts, function(err, results) {
    if (err) return console.log(err);

    console.dir(results);
});
