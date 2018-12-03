.PHONY: default clean
default:
	mkdir -p build
	npm install --prefix src
	cd src && zip -r9 alexa-youtube-skill.zip node_modules util *.js *.json 
	mv src/alexa-youtube-skill.zip build
clean:
	rm -rf src/node_modules
	rm -rf build
