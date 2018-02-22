#!/usr/bin/env node
"use strict";

const program = require('commander');
const fs = require('fs');
const async = require('async');
const walker = require('walker');
const cookieStore = require('tough-cookie-file-store');
var request = require('request');

const cookieFilePath = './mangadex-cookies.json';
const versionCode = '0.1.2';
var cookieJar;

//Create cookie-file (if not exists)
fs.appendFile(cookieFilePath, '', function (err) {
	if (!err) {
		//Make request use the filestore
		try {
			cookieJar = request.jar(new cookieStore(cookieFilePath));
			request = request.defaults({
					jar: cookieJar,
					headers: {
						'User-Agent': 'Icelord-MangaDex-BulkUploader/' + versionCode
					}
				});
		} catch (ex) {
			console.log('Error: The cookiefile "' + cookieFilePath + '" seems to be broken');
			console.log(ex);
			process.exit(8);
		}

		//Execute cli-command accordingly
		program.parse(process.argv);
	} else {
		console.log('Error: The cookiefile "' + cookieFilePath + '" is inaccessible');
		process.exit(7);
	}
});

//Handle the generate-command
program
	.command('generate')
	.description('Generates a upload template.')
	.option('-d, --directory <directory>')
	.option('-t, --template <template_path>')
	.option('-v, --volume_regex <volume_regex>')
	.option('-c, --chapter_regex <chapter_regex>')
	.option('-n, --title_regex <title_regex>')
	.option('-g, --group <group>', '', parseInt)
	.option('-l, --language <language>', '', parseInt)
	.action((options) => {
		//Check input
		if (!Number.isInteger(options.group)) { options.group = -1; }
		if (!options.language) { options.language = 1; }
		if (!Number.isInteger(options.language)) { console.log('Error: Invalid language-id'); process.exit(12) }
		if (options.volume_regex === undefined) { options.volume_regex = 'v(?:olume(?:.)?)?(\\d+)'; }
		if (options.chapter_regex === undefined) { options.chapter_regex = 'c(?:h(?:apter)?)?(?:\\D)?(\\d+([\\.|x|p]\\d+)?)'; }
		if (!options.template) { console.log('Error: No template-file has been specified'); process.exit(4); }

		//Check regex
		let regex_check = loadRegex(options.volume_regex);
		if (!regex_check.err) { options.volume_regex = regex_check.regex; console.log('Using volume-regex: ' + options.volume_regex); } else { console.log('Error: Invalid regex supplied for volume.'); process.exit(2); }
		regex_check = loadRegex(options.chapter_regex);
		if (!regex_check.err) { options.chapter_regex = regex_check.regex; console.log('Using chapter-regex: ' + options.chapter_regex); } else { console.log('Error: Invalid regex supplied for chapter.'); process.exit(3); }
		if (options.title_regex !== undefined) {
			regex_check = loadRegex(options.title_regex);
			if (!regex_check.err) {
				options.title_regex = regex_check.regex;
				console.log('Using title-regex: ' + options.title_regex);
			} else {
				console.log('Error: Invalid regex supplied for title');
				process.exit(1);
			}
		}

		//Scan directory for files
		let found_files = [];
		console.log('Scanning directory: ' + options.directory);
		walker(options.directory)
			.on('file', (file, stat) => {
				if (file.toLowerCase().endsWith('.zip')) {
					found_files.push(file);
				}
			})
			.on('error', (err, entry, stat) => {
				console.log('Error: Scanning the directory failed.');
				console.log(entry);
				process.exit(1);
			})
			.on('end', () => {
				console.log('Done!');
				console.log(found_files);

				//Sort files in alphabetical order
				found_files.sort((a, b) => a.localeCompare(b));

				//Loop through found files and fetch data from filepath/filename
				let template = [];
				found_files.forEach((file) => {
					let entry = {
						file: file,
						title: '',
						group: options.group,
						language: options.language
					};

					//Match volume
					entry.volume = options.volume_regex.exec(file);
					if (entry.volume && entry.volume.length >= 2) {
						entry.volume = parseInt(entry.volume[1]);
					} else { entry.volume = -1; }

					//Match chapter
					entry.chapter = options.chapter_regex.exec(file);
					if (entry.chapter && entry.chapter.length >= 2) {
						entry.chapter = parseFloat(entry.chapter[1].replace('x', '.').replace('p', '.'));
					} else { entry.chapter = 0; }

					if (options.title_regex !== undefined) {
						// Match title
						entry.title = options.title_regex.exec(file);
						if (entry.title && entry.title.length > 0) {
							// pick the last group as the title
							entry.title = entry.title[entry.title.length-1];
						} else {
							entry.title = '';
						}
					}

					template.push(entry);
				});

				//Save
				fs.writeFile(options.template, JSON.stringify(template, null, 4), (err) => {
					if (!err) {
						console.log('Template-generation complete!');
					} else {
						console.log('Error: Could not write the template-file');
						console.log(err);
						process.exit(4);
					}
				});
			});
	});

//Handle the login-command
program
	.command('login')
	.description('Login to mangadex. Generate a cookie-file')
	.option('-u, --username <username>')
	.option('-p, --password <password>')
	.action((options) => {
		if (!options.username) { console.log('Error: No username was provided'); process.exit(5); }
		if (!options.password) { console.log('Error: No password was provided'); process.exit(6); }

		console.log('Logging in as "' + options.username + '"...');
		request.post(
			{
				url: 'https://mangadex.com/ajax/actions.ajax.php?function=login',
				headers: {
					'referer': 'https://mangadex.com/login',
					'X-Requested-With': 'XMLHttpRequest'
				},
				formData: {
					login_username: options.username,
					login_password: options.password
				}
			},
			(err, httpResponse, body) => {
				if (!err) {
					isLoggedIn((err, logged_in) => {
						if (!err) {
							if (logged_in) {
								console.log('Login successful!');
							} else {
								console.log('Error: Not logged in. Probably wrong username or password!');
								process.exit(11);
							}
						} else {
							console.log('Error: Login-check failed!');
							console.log(err);
							process.exit(10);
						}
					});
				} else {
					console.log('Error: Login failed!');
					console.log(err);
					process.exit(9);
				}
			});
	});

//Handle the upload-command
program
	.command('upload')
	.description('Upload according to upload template. Make sure login first!')
	.option('-t, --template <template_path>')
	.option('-m, --manga <n>', '', parseInt)
	.option('-r, --resume <n>', '', parseInt)
	.action((options) => {
		//Check if user is logged in
		isLoggedIn((err, logged_in) => {
			if (!err) {
				if (logged_in) {
					//Check input
					if (!Number.isInteger(options.manga)) { console.log('Error: No manga was specified.'); process.exit(13); }
					if (!Number.isInteger(options.resume)) { options.resume = 1; }
					if (!options.template) { console.log('Error: No template-file has been specified'); process.exit(4); }

					//Load template
					fs.readFile(options.template, 'utf8', function (err, data) {
							if (!err) {
								try {
									let parsedTemplate = JSON.parse(data);
									let uploadTasks = [];

									//Create upload-task for each chapter
									for (let i = options.resume -1; i < parsedTemplate.length; i++) {
										uploadTasks.push((cb) => {
											console.log('Uploading: Vol. ' + parsedTemplate[i].volume + ' Ch. ' + parsedTemplate[i].chapter);
											uploadChapter(options.manga, parsedTemplate[i], (err, success) => {
												if (!err) {
													cb(null);
												} else {
													cb({ err: err, position: i });
												}
											});
										});
									}

									//Start process
									async.series(uploadTasks, (err, results) => {
										if (!err) {
											console.log('All done!');
										} else {
											console.log('Error: An upload failed!');
											console.log(err);
											console.log('\nIf you want to resume at this position later use the resume-option (-r) with a value of ' + (err.position +1));
											console.log('Should you like to skip this chapter use the resume-option with a value of ' + (err.position +2));
										}
									});
								} catch (ex) {
									console.log('Error: Template-file is broken');
									console.log(ex);
									process.exit(14);
								}
							} else {
								console.log('Error: Template-file is inaccessible');
								process.exit(4);
							}
						});
				} else {
					console.log('Error: You are not logged in!');
					process.exit(15);
				}
			} else {
				console.log('Error: Login-check failed!');
				console.log(err);
				process.exit(10);
			}
		});
	});


//Handle general stuff & --help
program
	.version(versionCode)
	.on('--help', () => {
		console.log('\n\n  Options of the commands:\n');

		console.log('\tgenerate');
		console.log('\t\t-d, --directory <directory>\t\tDirectory which should be scanned (eg: "/path/to/scan")')
		console.log('\t\t-t, --template <template_path>\t\tPath where the template should be stored (eg: "/path/template.json")');
		console.log('\t\t-v, --volume_regex <volume_regex>\tRegex (case-insensitive) to detect the volume. Default: "v(?:olume(?:.)?)?(\\d+)"');
		console.log('\t\t-c, --chapter_regex <chapter_regex>\tRegex (case-insensitive) to detect the chapter. Default: "c(?:h(?:apter)?)?(?:\\D)?(\\d+([\\.|x|p]\\d+)?)"');
		console.log('\t\t-l, --language <language_id>\t\tID of the language (eg: 1) (Default: 1 (english))');
		console.log('\t\t-g, --group <n>\t\t\t\tDefault group for chapters in this template (eg: 657)\n');

		console.log('\tlogin');
		console.log('\t\t-u, --username <username>');
		console.log('\t\t-p, --password <password>\n');

		console.log('\tupload:');
		console.log('\t\t-t, --template <template_path>\t\tPath where the template should be stored (eg: "/path/template.json")');
		console.log('\t\t-m, --manga <manga>\t\t\tThe id of the manga (eg: 412)')
		console.log('\t\t-r, --resume <resume_at>\t\tPosition to resume at (eg: 1) (Default: 1)');

		console.log('\n\n  Instructions:\n');
		console.log('\t(1) Generate a template using "generate"');
		console.log('\t(2) Open the generated template and fill in the missing fields');
		console.log('\t(3) Log in using the "login"-command');
		console.log('\t(4) Upload using the "upload"-command');
	});


//Function to load regex safely
function loadRegex(regex) {
	try {
		return { err: null, regex: new RegExp(regex, 'i') };
	} catch(ex) {
		return { err: ex, regex: null };
	}
}

//Function to load JSON safely
function loadJSON(string) {
	try {
		return { err: null, json: JSON.stringify(string) };
	} catch(ex) {
		return { err: ex, json: null };
	}
}

//Check if user is logged in
function isLoggedIn(cb) {
	request('https://mangadex.com/follows', function (err, response, body) {
		cb(err, !body.includes('login_username'));
	});
}

//Function to upload a chapter
function uploadChapter(manga, chapter, cb) {
	//Fix cases where no volume or group is specified
	if (chapter.volume === -1) { chapter.volume = ''; }
	if (chapter.group === -1) { chapter.group = 2; }

	//Check if file can be read
	request.post(
		{
			url: 'https://mangadex.com/ajax/actions.ajax.php?function=chapter_upload',
			headers: {
				'referer': 'https://mangadex.com/upload/' + manga,
				'X-Requested-With': 'XMLHttpRequest'
			},
			formData: {
				manga_id: manga,
				chapter_name: chapter.title,
				volume_number: chapter.volume,
				chapter_number: chapter.chapter,
				group_id: chapter.group,
				lang_id: chapter.language,
				file: fs.createReadStream(chapter.file)
			}
		},
		(err, httpResponse, body) => {
			if (!err) {
				if (httpResponse.statusCode == 200) {
					cb(null, true);
				} else {
					cb({ msg: 'Invalid statusCode', statusCode: httpResponse.statusCode }, false);
				}
			} else {
				cb(err, false);
			}

		});
}


//Error-codes:
//	 0 -> OK
//	 1 -> Scanning the directory failed
//	 2 -> Invalid Volume-Regex
//	 3 -> Invalid Chapter-Regex
//	 4 -> Template-file inaccessible
//	 5 -> No username supplied
//	 6 -> No password supplied
//	 7 -> Cookie-file inaccessible
//	 8 -> Cookie-file broken
//	 9 -> Login failed (request-error)
//	10 -> Login-check failed (request-error)
//	11 -> Login failed (probably wrong username or password)
// 	12 -> Invalid language_id
//	13 -> Invalid manga_id
//	14 -> Template-file is broken
//	15 -> User is not logged in
