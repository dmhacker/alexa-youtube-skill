default:
	npm install --prefix src
	mkdir -p build
	zip -r build/alexa-youtube-skill.zip src/*
