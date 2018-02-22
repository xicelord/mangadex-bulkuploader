# Getting started:
1. Install NodeJS (if you haven't already)
2. Fetch the respository (or download it as zip)
3. Download the dependencies ("npm i")
4. Execute a command ("node index [command] [options]")


# Usage:

  index [command] [options]

## Commands:

    generate [options]  Generates a upload template.
    login [options]     Login to mangadex. Generate a cookie-file
    upload [options]    Upload according to upload template. Make sure login first!


## Options of the commands:

	generate
		-d, --directory <directory>		Directory which should be scanned (eg: "/path/to/scan")
		-t, --template <template_path>		Path where the template should be stored (eg: "/path/template.json")
		-v, --volume_regex <volume_regex>	Regex (case-insensitive) to detect the volume. Default: "v(?:ol|olume)?\D?(\d+)"
		-c, --chapter_regex <chapter_regex>	Regex (case-insensitive) to detect the chapter. Default: "c(?:h(?:apter)?)?(?:\D)?(\d+([\.|x|p]\d+)?)"
		-n, --title_regex <title_regex>		Regex (case-insensitive) to detect the title. (No default)
		-l, --language <language_id>		ID of the language (eg: 1) (Default: 1 (english))
		-g, --group <n>				Default group for chapters in this template (eg: 657)

	login
		-u, --username <username>
		-p, --password <password>

	upload:
		-t, --template <template_path>		Path where the template should be stored (eg: "/path/template.json")
		-m, --manga <manga>			The id of the manga (eg: 412)
		-r, --resume <resume_at>		Position to resume at (eg: 1) (Default: 1)


## Instructions:

	(1) Generate a template using "generate"
	(2) Open the generated template and fill in the missing fields
	(3) Log in using the "login"-command
	(4) Upload using the "upload"-command
