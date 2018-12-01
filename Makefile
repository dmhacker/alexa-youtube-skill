default:
	mkdir -p build
	$(MAKE) -C src
	mv src/alexa-youtube-skill.zip build
