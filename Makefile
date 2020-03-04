.PHONY: default clean
default:
	mkdir -p build
	npm install
	zip -r9 alexa-youtube-skill.zip node_modules util *.js *.json 
	mv alexa-youtube-skill.zip build
clean:
	rm -rf build
