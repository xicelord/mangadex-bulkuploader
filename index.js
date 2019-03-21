#!/usr/bin/env node
"use strict";

const program = require('commander');
const fs = require('fs');
const async = require('async');
const walker = require('walker');
const cookieStore = require('tough-cookie-file-store');
const util = require('util');
const stringSimilarity = require('string-similarity');

var request = require('request');
var glob = require('glob');
var uploadQueue = [];

const cookieFilePath = './mangadex-cookies.json';
const versionCode = '0.2.0';
var cookieJar;

// Load config if exists
var config = {};
try {
	if (fs.existsSync('./config.json')) {
		let dat = fs.readFileSync('./config.json');
		config = JSON.parse(dat);
	}
} catch (ex) {
	console.log("Exception thrown trying to read config file: ",ex);
}

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
	.option('-g, --group <group>', 'All associated comma-separated scanlation group IDs')
	.option('-l, --language <language>', '', parseInt)
	.action((options) => {
		//Check input

		// Parse group parameter
		if (options.group) {
			let tmp = options.group.toString().split(',');
			options.group = [];

			for (let i = 0; i <= 2; i++) {
				if (tmp[i])
					options.group.push(parseInt(tmp[i].trim()));
				else
					options.group.push(0);
			}
		} else {
			options.group = [0,0,0];
		}

		if (!options.language) { options.language = 1; }
		if (!Number.isInteger(options.language)) { console.log('Error: Invalid language-id'); process.exit(12) }
		if (options.volume_regex === undefined) { options.volume_regex = 'v(?:ol|olume)?\\D?(\\d+)'; }
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
				process.exit(16);
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
			
			 	// Used for padding secondary chapter numbers. "01.1" and "1.1" are counted differently
				let secondary_numbering_length = {};
				found_files.forEach((file) => {
					let chapter_result = options.chapter_regex.exec(file);
					if (chapter_result && chapter_result.length >= 2 ) {
						let [primary, secondary] = chapter_result[1].split(".");
						//Make sure we don't get a `NaN` or `TypeError`
						secondary_numbering_length[primary] = secondary_numbering_length[primary] || 0;
						secondary = secondary || "";
		
						secondary_numbering_length[primary] = Math.max(secondary_numbering_length[primary], secondary.length);
					}
				});

				//Loop through found files and fetch data from filepath/filename
				let template = [];
				found_files.forEach((file) => {
					let entry = {
						file: file,
						title: '',
						group: options.group[0],
						group_2: options.group[1],
						group_3: options.group[2],
						language: options.language
					};

					//Match volume
					let volume_result = options.volume_regex.exec(file);
					if (volume_result && volume_result.length >= 2) {
						entry.volume = parseInt(volume_result[1]);
					} else { entry.volume = -1; }

					//Match chapter
					let chapter_result = options.chapter_regex.exec(file);
					if (chapter_result && chapter_result.length >= 2) {
						entry.chapter = chapter_result[1].replace('x', '.').replace('p', '.');
						let [primary, secondary] = entry.chapter.split(".");
						if (secondary !== undefined) { //Checks that secondary number exists. e.g. `7` => `7`. If you use `7.`, then- Wait, why you using `7.`?
							entry.chapter = [primary, secondary.padStart(secondary_numbering_length[primary], "0")].join(".");
						} else if (secondary === "") {
							console.warn(`Trailing "." for Chapter: ${entry.chapter}, File: ${file}`);
						}
					} else { entry.chapter = 0; }

					//Title-regex supplied? -> Match title
					if (options.title_regex !== undefined) {
						let title_result = options.title_regex.exec(file);
						if (title_result.title && title_result.length > 0) {
							// pick the last group as the title
							entry.title = title_result[title_result.length-1];
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

		// use config if exists or options.
		options.username = options.username || config.username || undefined;
		options.password = options.password || config.password || undefined;

		if (!options.username) { console.log('Error: No username was provided'); process.exit(5); }
		if (!options.password) { console.log('Error: No password was provided'); process.exit(6); }

		console.log('Logging in as "' + options.username + '"...');
		request.post(
			{
				url: 'https://mangadex.org/ajax/actions.ajax.php?function=login',
				headers: {
					'referer': 'https://mangadex.org/login',
					'X-Requested-With': 'XMLHttpRequest'
				},
				formData: {
					login_username: options.username,
					login_password: options.password,
					remember_me: '1'
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

					// Support glob if string contains a *
					if (options.template.indexOf('*') !== -1) {

						glob(options.template, [], function (err, files) {

							// Sanity-chech and list the templates that will be uploaded
							if (files.length < 1) {
								console.log('Error: No template-files have been found!');
								process.exit(1);
							} else {
								console.log(util.format("Batch-uploading %d template-files:", files.length));
								for (var i = 0; i < files.length; i++) {
									console.log("\t"+files[i]);
									uploadQueue.push(files[i]);
								}
								console.log(); // Newline
							}

							let templateTasks = [];
							for (var i = 0; i < uploadQueue.length; i++) {
								templateTasks.push((cb) => {
									let path = uploadQueue.pop();
									console.log('Processing template '+path);
									processTemplate(path, options);
								});
							}

							uploadQueue.reverse();
							async.series(templateTasks, (err, results) => {
								if (!err) {
									console.log('All templates processed!');
								}
							});
						});
					}
					else {
						// Regular single-path
						processTemplate(options.template, options);
					}

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

program
	.command('group <action> [search]')
	.description('Searches for groups inside a cached db')
	.action((options, search) => {

		switch (options) {
			case "update":
				buildGroupCache();
				break;

			case "search":
				if (search.length < 1) {
					console.log("Not enough search terms specified.");
					process.exit(1);
				}
				searchGroupCache(search);
				break;

			default:
				console.log("No action specified. Nothing to do...");
		}

	});


//Handle general stuff & --help
program
	.version(versionCode)
	.on('--help', () => {
		console.log('\n\n  Options of the commands:\n');

		console.log('\tgenerate');
		console.log('\t\t-d, --directory <directory>\t\tDirectory which should be scanned (eg: "/path/to/scan")')
		console.log('\t\t-t, --template <template_path>\t\tPath where the template should be stored (eg: "/path/template.json")');
		console.log('\t\t-v, --volume_regex <volume_regex>\tRegex (case-insensitive) to detect the volume. Default: "v(?:ol|olume)?\\D?(\\d+)"');
		console.log('\t\t-c, --chapter_regex <chapter_regex>\tRegex (case-insensitive) to detect the chapter. Default: "c(?:h(?:apter)?)?(?:\\D)?(\\d+([\\.|x|p]\\d+)?)"');
		console.log('\t\t-n, --title_regex <title_regex>\t\tRegex (case-insensitive) to detect the title. (No default)')
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

// Processes a template file at $templatePath and uploads its contents
function processTemplate(templatePath, options)
{
	//Load template
	fs.readFile(templatePath, 'utf8', function (err, data) {
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
}

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
	request('https://mangadex.org/follows', function (err, response, body) {
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
			url: 'https://mangadex.org/ajax/actions.ajax.php?function=chapter_upload',
			headers: {
				'referer': 'https://mangadex.org/upload/' + manga,
				'X-Requested-With': 'XMLHttpRequest'
			},
			formData: {
				manga_id: manga,
				chapter_name: chapter.title,
				volume_number: chapter.volume,
				chapter_number: chapter.chapter,
				group_id: chapter.group,
				group_id_2: (chapter.group_2 === -1) ? undefined : chapter.group_2,
				group_id_3: (chapter.group_3 === -1) ? undefined : chapter.group_3,
				lang_id: chapter.language,
				file: fs.createReadStream(chapter.file)
			}
		},
		(err, httpResponse, body) => {
			if (!err) {
				if (httpResponse.statusCode == 200) {
					if (body === '') {
						cb(null, true);
					} else {
						cb({ msg: 'Server rejected the chapter', response: body }, false);
					}
				} else {
					cb({ msg: 'Invalid statusCode', statusCode: httpResponse.statusCode }, false);
				}
			} else {
				cb(err, false);
			}

		});
}

function buildGroupCache()
{
	console.log("Retrieving group list (Must be logged in or list is empty!!)...");
	request.get(
		{
			url: 'https://mangadex.org/upload/1',
			headers: {
				'referer': 'https://mangadex.org/'
			}
		},
		(err, httpResponse, body) => {
			if (!err) {
				if (httpResponse.statusCode == 200) {

					// Start matching
					var regex = new RegExp('<option data-subtext=\'(|[^<]+)\' value=\'([0-9]+)\'>([^<]+)<', 'ig');
					var match;
					let groupList = [];
					let idList = [];
					var n = 0;
					console.log("Parsing...");
					while ((match = regex.exec(body)) !== null) {
						var id = parseInt(match[2]);
						// Check if the id is already present
						if (idList.indexOf(id) > -1)
							continue;
						idList.push(id);

						groupList.push({
							name: match[3],
							id: id,
							open: (match[1] === '')
						});
						n++;
					}
					console.log(util.format("Successfully processed %d groups", n));
					var json = JSON.stringify(groupList);
					fs.writeFile('groupcache.json', json, (err) => {
						if (err) {
							console.log("Failed to write groupCache to disk!");
							console.log(err);
							process.exit(1);
						}
						console.log("Group cache updated.");
					});
				}
				else {
					console.log("Failed to retrieve upload page, unexpected http code", httpResponse.statusCode);
				}
			} else {
				console.log("Failed to retrieve upload page", err);
			}
		}
	);
}

function searchGroupCache(keyword)
{
	if (!fs.existsSync("groupcache.json")) {
		console.log("Group cache doesn't exist, try running 'group update' first.");
		process.exit(1);
	}
	fs.readFile("groupcache.json", "utf8", (err, data) => {
		if (err) throw err;

		var groupList = JSON.parse(data);
		var searchEntries = [];

		for (var i = 0; i < groupList.length; i++) {
			if (!groupList[i].open) continue; // Skip closed groups
			groupList[i].score = stringSimilarity.compareTwoStrings(groupList[i].name, keyword);
			if (groupList[i].score >= 0.4)
				searchEntries.push(groupList[i]);
		}
		// Sort by score
		searchEntries.sort((a, b) => {return b.score - a.score});

		if (searchEntries.length > 0) {
			console.log("Best matches (max. 10):\n\n ID\tNAME (SCORE)\n==============================");
			for (var i = 0; i < 10 && i < searchEntries.length; i++) {
				console.log(util.format(" %d\t%s (%f)", searchEntries[i].id, searchEntries[i].name, searchEntries[i].score.toFixed(2)));
			}
		} else {
			console.log("No matches found.");
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
//	16 -> Invalid Title-Regex
