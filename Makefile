.PHONY: default clean
default:
	mkdir -p build
	$(MAKE) default -C src
	mv src/alexa-youtube-skill.zip build
clean:
	rm -rf build
	$(MAKE) clean -C src
