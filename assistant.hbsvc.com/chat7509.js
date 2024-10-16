window.hbai = {
	// Known listeners:
	//		"change" - run whenever changes happen
	//		"reset" - run when the main scroll should be reset
	//		"newchat" - run when a new chat starts
	//		"loadchat" - run when an existing chat is loaded
	//		"jobtype" - runs when a job type message is recieved
	//		"progress" - update to the current response
	//		"removetemp" - remove the temp message
	//		"devmsg" - handle developer messages
	//		"image" - handle an image being added (onload)
	//		"usermsg" - handle a user message
	//		"asstmsg" - handle an assistant message
	//		"scrolltobottom" - scroll the main chat window to the bottom
	//		"convlist" - handle a list of conversations
	//		"stt" - speech to text output
	//		"tts" - text to speech output
	//		"ttsstart" - text to speech streaming output start
	//		"ttschunk" - text to speech streaming output chunk
	//		"ttsend" - text to speech streaming output end
	//		"compdone" - completion finished text
	//		"histsettings" - history settings change
	//		"compid" - completion job id
	//		"retrystarted" - retry started
	//		"limitreached" - limit reached
	listens: { },
	ws: false,
	wsTS: 0,
	open: false,
	opening: false,
	ready: false,
	to_do: [],
	actor: false,
	con_id: false,
	in_prog: false,
	cur_inp: '',
	last_msg: false,
	last_reply: false,
	key: false,
	histories: [],
	active_hist: false,
	ip: false,
	auth: false,
	cinfo: false,
	last_ts: false,
	close_flag: false,
	hb_int: false,
	in_int: false,
	pause_user: false,
	restarting: false,
	skip_initial: false,
	use_sel: false,
	last_pop: '',
	credits: 150000,
	
	// integer - number of seconds of inactivity to pause the connection
	timeout: 600,
	
	// function - style or format search results data
	formatsr: false,
	
	// function - style or format image search results data
	formatimg: false,
	
	// function - style or format chat messages
	formattxt: false,
	
	// object of functions for simple task outputs
	simplefmt: {},
	
	// initialize the socket and heartbeat, also set the usage key
	init: (k, skip = false) => {
		hbai.key = k;
		hbai.close_flag = false;
		hbai.skip_initial = skip;
		
		var c = hbai.getCookie('hbai_actor');
		if (c && !hbai.actor) {
			hbai.actor = c;
		}
		
		hbai.openSocket();
		
		hbai.hb_int = setInterval(() => hbai.doHB(), 25000);
		
		hbai.in_int = setInterval(() => {
			if ((hbai.inactiveSeconds() > hbai.timeout) && hbai.open) {
				hbai.devMsg('pausing for inactivity');
				hbai.closeSocket();
			}
		}, 10000);
		
		hbai.activity();
	},
	
	// scroll the chat window to the bottom
	scrollToBottom: () => hbai.trigger("scrolltobottom"),
	
	// set the user's IP (also sets location)
	setIP: (ip) => {
		hbai.ip = ip;
		hbai.send({type: 'set_ip', ip: hbai.ip});
	},
	
	setAuth: (k) => {
		hbai.auth = k;
		hbai.send({type: 'check_auth', auth_key: hbai.auth});
	},
	
	// set the user's client info (also sets ip/location)
	setClientInfo: (cinfo) => {
		hbai.setIP(cinfo.ip);
		hbai.cinfo = cinfo;
		hbai.send({type: 'set_client_info', info: hbai.cinfo});
	},
	
	trigger: (evt, ...data) => {
		for (let x of hbai.listens[evt] || []) {
			try {
				x(...data);
			} catch(e) {
				console.error(e);
			}
		}
		return hbai;
	},
	
	on: (evt, cb) => {
		if (typeof cb == "function") {
			let l = hbai.listens;
			for (let e of evt.split(/\s+/g)) {
				if (l[e]) {
					l[e].push(cb);
				} else {
					l[e] = [cb];
				}
			}
		}
		return hbai;
	},
	
	one: (evt, cb) => {
		let cb2 = function(...args) {
			if (cb(...args) !== false) {
				hbai.off(evt, cb2);
			}
		};
		return hbai.on(evt, cb2);
	},
	
	off: (evt, cb) => {
		let l = hbai.listens;
		for (let e of evt.split(/\s+/g)) {
			if (e in l) {
				if (cb) {
					l[e] = l[e].filter(x => x !== cb);
				} else {
					delete l[e];
				}
			}
		}
		return hbai;
	},
	
	// send a new user chat
	sendChat: (msg, img = false, block_search = false, bot_id = null, model_id = null, sys = null) => {
		if ((msg || img) && !hbai.in_prog) {
			let trim_mode, trim_num, opts = { };
			if (typeof block_search == "object") {
				opts = block_search;
				trim_num = opts.trim_num || 0;
				trim_mode = opts.trim_mode || null;
				block_search = opts.block_search || false;
				model_id = opts.model_id || null;
				bot_id = opts.bot_id || null;
				sys = opts.sys || null;
			}
			
			hbai.in_prog = true;
			hbai.cur_inp = "";
			let msgobj = msg.trim();
			if (img) {
				msgobj = [{
					type: "image_url",
					image_url: {
						url: img,
						detail: "low"
					}
				}];
				if (msg.trim()) {
					msgobj.unshift({
						type: "text",
						text: msg.trim()
					});
				}
			}
			hbai.addOutput("user", msgobj);
			let t = img? "new_chat_img" : "new_chat";
			let m = {type: t, msg: msgobj, id: hbai.active_hist, block_search: block_search};
			if (bot_id) {
				m.bot_id = bot_id;
			}
			if (model_id) {
				m.model = model_id;
			}
			if (sys) {
				m.sys = sys;
			}
			if (trim_num > 0) {
				m.trim_hist = { num: trim_num, mode: trim_mode || "trim" };
			}
			hbai.send(m);
			hbai.activity();
		}
	},
	
	// send a search request
	sendSearch: (msg, bot_id = null, model_id = null) => {
		if (msg && !hbai.in_prog) {
			hbai.in_prog = true;
			hbai.cur_inp = '';
			var msgobj = msg.trim();
			hbai.addOutput('user', msgobj);
			let m = {type: 'new_search', msg: msgobj, id: hbai.active_hist};
			if (bot_id) {
				m.bot_id = bot_id;
			}
			if (model_id) {
				m.model = model_id;
			}
			hbai.send(m);
			hbai.activity();
		}
	},
	
	// send audio for transcription
	sendAudio: (dat) => {
		hbai.send({type: 'stt_input', dat: dat});
	},
	
	// send text for audio
	sendTTS: (txt, index = 0) => {
		hbai.send({type: 'tts_input', txt: txt, index: index});
	},
	
	// send text for audio (streaming)
	streamTTS: (txt) => {
		hbai.send({type: 'tts_input_stream', txt: txt});
	},
	
	// retry the last generation
	redoLastChat: () => {
		if (!hbai.in_prog) {
			hbai.last_reply = false;
			hbai.trigger('retrystarted');
			hbai.in_prog = true;
			hbai.cur_inp = '';
			hbai.send({type: 'retry_last', id: hbai.active_hist});
			hbai.activity();
		}
	},
	
	compareLast: (bot_id, model_id, search, sys = null) => {
		if (!hbai.in_prog) {
			hbai.last_reply = false;
			hbai.trigger('comparestarted');
			hbai.in_prog = true;
			hbai.send({type: 'compare_last', id: hbai.active_hist, bot: bot_id, model: model_id, search: search ? 1 : 0, sys: sys || ''});
			hbai.activity();
		}
	},
	
	// reset the chat history
	resetChat: () => {
		hbai.last_msg = false;
		hbai.last_reply = false;
		hbai.onChange();
		hbai.send({type: 'reset_chat', id: hbai.active_hist});
		hbai.activity();
	},
	
	// set the active conversation
	selectHistory: id => {
		if (hbai.histories[id]) {
			hbai.active_hist = id;
			hbai.send({type: 'get_history', id: id});
			hbai.activity();
		}
	},
	
	// delete a chat history
	deleteHistory: id => {
		if (hbai.active_hist == id) {
			hbai.active_hist = false;
		}
		hbai.send({type: "delete_history", id: id});
		hbai.activity();
	},
	
	deleteAllHistories: () => {
		hbai.send({type: "delete_all_hist"});
		hbai.activity();
	},
	
	trimHistory: (id, mode, num) => {
		hbai.send({type: "trim_history", id: id, mode: mode, num: num });
		hbai.activity();
	},
	
	makePDFText: (file, name) => {
		hbai.send({type: "pdf_txt", file: file, name: name});
	},
	
	getText: id => {
		hbai.send({type: "get_txt", id: id});
	},
	
	// start a new chat history
	addHistory: (comp = "hba", sys = "", bot_id = 0, title = false) => {
		var found = false;
		if (hbai.histories && (comp == "hba")) {
			var k = Object.keys(hbai.histories).find(x => hbai.isNewChat(hbai.histories[x]));
			if (k) {
				found = true;
				hbai.selectHistory(k);
				hbai.onConversationList();
			}
		}
		if (!found && (comp == 'hba')) {
			hbai.active_hist = false;
			hbai.send({type: 'new_history'});
		}
		if (comp != 'hba') {
			hbai.use_sel = true;
			hbai.active_hist = false;
			let dat = {type: 'new_bot', comp: comp, sys: sys, bot_id: bot_id};
			if (title) {
				dat.name = title;
			}
			hbai.send(dat);
		}
		hbai.activity();
	},
	
	// change the name of a conversation
	renameHistory: (id, n) => {
		hbai.send({type: 'rename_hist', id: id, name: n});
		hbai.activity();
	},
	
	// send feedback on the last reply
	feedback: (good) => {
		if (hbai.last_msg && hbai.last_reply) {
			hbai.send({type: good ? 'fb_up' : 'fb_down', prompt: hbai.last_msg, reply: hbai.last_reply});
			hbai.last_msg = false;
			hbai.last_reply = false;
			hbai.onChange();
		}
		hbai.activity();
	},
	
	// signal the system to start back up if it was on pause
	restart: () => {
		if (hbai.key && hbai.close_flag) {
			hbai.close_flag = false;
			hbai.restarting = true;
			hbai.init(hbai.key, hbai.skip_initial);
		}
	},
	
	// reset a conversation and replace the starter message with a new one
	replaceStarter: (msg) => {
		hbai.send({type: 'replace_starter', id: hbai.active_hist, msg: msg});
		hbai.pause_user = true;
	},
	
	setHistorySettings: (id, set) => {
		hbai.send({type: 'history_setting', id: id, settings: set });
	},
	
	setHistorySetting: (id, set, val) => {
		hbai.send({type: 'history_setting', id: id, setting: set, val: val});
	},
	
	// return boolean representing if the current conversation can upload images
	canReadImages: () => {
		if (hbai.active_hist && hbai.histories[hbai.active_hist]) {
			return hbai.histories[hbai.active_hist].model?.read_image;
		}
		return false;
	},
	
	activeHistorySettings: () => {
		if (hbai.active_hist && hbai.histories[hbai.active_hist]) {
			return hbai.histories[hbai.active_hist];
		}
		return null;
	},
	
	openSocket: () => {
		if (hbai.opening) {
			return;
		}
		hbai.opening = true;
		hbai.wsTS = Date.now();
		hbai.devMsg('opening socket - ' + hbai.wsTS);
		hbai.ws = new WebSocket(window.hbai_socket || "wss://assistant.hbsvc.com/");
		
		hbai.ws.onopen = (e) => {
			hbai.devMsg('socket opened - ' + Date.now());
			hbai.opening = false;
			hbai.open = true;
			hbai.send({type: 'key', k: hbai.key});
		};
		
		hbai.ws.onclose = (e) => {
			hbai.opening = false;
			hbai.devMsg('socket closed - ' + Date.now());
			if (!hbai.close_flag) {
				hbai.open = false;
				hbai.con_id = false;
				hbai.restarting = true;
				hbai.openSocket();
			}
		};
		
		hbai.ws.onmessage = (e) => {
			hbai.handleMessage(JSON.parse(e.data));
		};
		
		hbai.ws.onerror = (e) => {
			hbai.devMsg('socket error - ' + Date.now());
			hbai.ws.onclose = null;
			console.error(e);
			hbai.opening = false;
			hbai.open = false;
			hbai.con_id = false;
			hbai.restarting = true;
			hbai.openSocket();
		};
	},
	closeSocket: () => {
		hbai.close_flag = true;
		
		if (hbai.ws) {
			hbai.ws.close();
		}
		if (hbai.hb_int) {
			clearInterval(hbai.hb_int);
		}
		if (hbai.in_int) {
			clearInterval(hbai.in_int);
		}
		hbai.ws = false;
		hbai.open = false;
		hbai.ready = false;
		hbai.con_id = false;
		hbai.last_msg = false;
		hbai.last_reply = false;
		hbai.activity();
	},
	activity: () => {
		hbai.last_ts = Date.now();
	},
	inactiveSeconds: () => {
		if (!hbai.last_ts) {
			return 0;
		}
		return Math.floor((Date.now() - hbai.last_ts) / 1000);
	},
	doHB: () => {
		if (hbai.open) {
			hbai.send({type: 'hb'});
		}
	},
	isNewChat: item => {
		if (item && typeof item == "object") {
			item = item.title;
		}
		return (typeof item == "string") && item.toLowerCase() == "new chat";
	},
	getSortedConvoKeys: (list, filter) => {
		let keys = Object.keys(list);
		return (filter? keys.filter(filter) : keys).sort((a, b) => {
			let bt = list[b].ts;
			let at = list[a].ts;
			return hbai.isNewChat(list[b])? 1 : (hbai.isNewChat(list[a])? -1 : ((bt > at) ? 1 : ((at > bt) ? -1 : 0)));
		});
	},
	getCookie: (n) => {
		return (document.cookie.match('(^|;)\\s*' + n + '\\s*=\\s*([^;]+)')?.pop() || '').trim();
	},
	setCookie: (n, v) => {
		document.cookie = n + "=" + v + "; expires=Fri, 02 Aug 2075 05:00:00 UTC; path=/";
	},
	handleMessage: (dat) => {
		dat.type = dat.type || 'unknown';
		if (dat.type != 'debug' && dat.type != 'hb') {
			hbai.activity();
		}
		switch (dat.type) {
		case 'init':
			hbai.con_id = dat.con;
			hbai.catchUp();
			hbai.in_prog = false;
			if (hbai.actor) {
				hbai.send({type: 'assert_act', replace: dat.new_act, actor_id: hbai.actor});
				hbai.setCookie('hbai_actor', hbai.actor);
			} else {
				hbai.actor = dat.new_act;
				hbai.setCookie('hbai_actor', hbai.actor);
				hbai.send({type: 'get_histories'});
				if (hbai.ip) {
					hbai.send({type: 'set_ip', ip: hbai.ip});
				}
				if (hbai.cinfo) {
					hbai.send({type: 'set_client_info', info: hbai.cinfo});
				}
			}
			break;
		case 'ack_act':
			hbai.send({type: 'get_histories'});
			if (hbai.ip) {
				hbai.send({type: 'set_ip', ip: hbai.ip});
			}
			if (hbai.cinfo) {
				hbai.send({type: 'set_client_info', info: hbai.cinfo});
			}
			break;
		case 'histories':
			var loadID, k = [];
			if (dat.hist) {
				hbai.histories = dat.hist;
				k = Object.keys(dat.hist);
			}	
			if (k[0]) {
				if (hbai.use_sel && dat.sel) {
					loadID = dat.sel;
				} else if (hbai.restarting) {
					loadID = hbai.active_hist || k[0];
				} else {
					var newChats = k.filter(i => hbai.isNewChat(dat.hist[i]));
					if (loadID = hbai.initial_chat) {
						hbai.initial_chat = false;
					} else if (hbai.active_hist && dat.hist[hbai.active_hist]) {
						loadID = hbai.active_hist;
					} else if (newChats[0]) {
						loadID = newChats[0];
					}
					if (newChats.length > 1) {
						let dels = newChats.includes(loadID)? newChats.filter(i => i != loadID) : newChats.slice(1);
						hbai.send({type: 'delete_histories', ids: dels });
					}
				}
			}
			if (!hbai.skip_initial) {
				if (loadID) {
					hbai.selectHistory(loadID);
				} else {
					hbai.send({type: 'new_history'});
				}
			}
			hbai.restarting = false;
			hbai.use_sel = false;
			hbai.onConversationList(dat.sel);
			break;
		case 'history_title':
			if (!hbai.histories[dat.id]) {
				hbai.histories[dat.id] = {
					title: dat.title,
					comp: 'hba'
				};
			}
			hbai.histories[dat.id].title = dat.title;
			hbai.onConversationList();
			break;
		case 'history':
			hbai.in_prog = false;
			hbai.ready = true;
			
			if (dat.id != hbai.last_pop) {
				hbai.last_msg = false;
				hbai.last_reply = false;
				hbai.onReset();
				hbai.onConversationList();
				let isnew = true;
				dat.hist.filter(x => x.role != 'system').forEach((item, i, msgs) => {
					hbai.addOutput(item.role, item.content, {
						type: item.chat_type,
						bot: item.bot_id,
						iter: i,
						iterLength: msgs.length
					});
					if (item.role == 'user') {
						isnew = false;
					}
				});
				hbai.scrollToBottom();
				hbai.trigger("loadconv", isnew && (dat.comp == 'hba'), dat.id, dat.hist);
			}
			hbai.send({type: 'get_balance'});
			hbai.last_pop = dat.id;
			break;
		case 'chat_delta':
			hbai.addProgress(dat.delta, dat.bot || false);
			break;
		case 'chat_full':
			hbai.in_prog = false;
			hbai.addOutput('assistant', dat.msg, { type: dat.chat_type, bot: dat.bot });
			if (dat.chat_type == 'over_limit') {
				hbai.trigger('limitreached');
			} else {
				hbai.send({type: 'get_snippet', id: dat.id});
			}
			break;
		case 'job_type':
			hbai.onJobType(dat.job_type);
			break;
		case 'debug':
			hbai.devMsg(dat);
			break;
		case 'replaced':
			hbai.pause_user = false;
			hbai.catchUp();
			break;
		case 'stt_output':
			hbai.onSTT(dat.txt);
			break;
		case 'tts_output':
			hbai.onTTS(dat.dat);
			break;
		case 'tts_output_start':
			hbai.onTTSStart(dat.job);
			break;
		case 'tts_output_chunk':
			hbai.onTTSChunk(dat.dat, dat.job);
			break;
		case 'tts_output_end':
			hbai.onTTSEnd(dat.job);
			break;
		case 'h_settings':
			hbai.trigger('histsettings', dat.hist, dat.set);
			break;
		case 'update_snippet':
			if (hbai.histories[dat.id]) {
				hbai.histories[dat.id].snip = dat.snip;
				hbai.histories[dat.id].ts = dat.ts;
				hbai.onConversationList();
			}
			break;
		case 'message_usage':
			hbai.devMsg(dat);
			hbai.send({type: 'get_balance'});
			break;
		case 'credit_balance':
			hbai.credits = parseInt(dat.bal);
			hbai.trigger('balance', dat.bal);
			break;
		case 'txt_info':
			hbai.devMsg(dat);
			break;
		case 'pdf_txt':
			hbai.trigger('pdf_txt', dat.txt, dat.file);
			break;
		}
	},
	catchUp: () => {
		while (hbai.to_do.length > 0) {
			hbai.send(hbai.to_do.shift());
		}
	},
	send: (dat) => {
		if (hbai.open && hbai.con_id && hbai.ws && (hbai.ws.readyState == 1) && !hbai.pause_user) {
			dat.con_id = hbai.con_id;
			hbai.ws.send(JSON.stringify(dat));
		} else {
			hbai.to_do.push(dat);
		}
		if (dat.type && (dat.type != 'hb')) {
			hbai.activity();
		}
	},
	addProgress: (delta, bot_id = false) => {
		if (hbai.in_prog) {
			hbai.cur_inp += delta;
			hbai.trigger('progress', hbai.formatMessage(hbai.cur_inp, true, true), bot_id);
			hbai.activity();
		}
	},
	escapeHTML: (msg, br) => {
		if (br) {
			msg = msg.replace(/<br\s*\/?>/g, "\n");
		}
		msg = msg.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
		if (br) {
			msg = msg.replace(/\n+/g, m => "<br>".repeat(Math.min(3, m.length)));
		}
		return msg;
	},
	replaceTextCodes: (str, texts) => {
		if (str && texts && str.length && texts.length) {
			for (let x of texts) {
				str = str.replaceAll(x.code, '[' + x.display + ']');
			}
		}
		return str;
	},
	formatMessage: (msg, esc_html = true, format_txt = true) => {
		if (typeof msg == 'object') {
			if (Array.isArray(msg)) {
				var ret = [];
				for (var i = 0; i < msg.length; i++) {
					ret.push(hbai.formatMessage(msg[i], esc_html, format_txt));
				}
				return ret.join(format_txt ? "<br><br>" : "\n");
			} else if (msg.type == 'text') {
				return hbai.formatMessage(msg.text, esc_html, format_txt);
			} else if (msg.type == 'image_url') {
				return hbai.formatMessage('<img src="' + msg.image_url.url + '" />', false, format_txt);
			}
		} else {
			if (typeof hbai.formattxt == 'function') {
				return hbai.formattxt(msg, esc_html, format_txt);
			} else {
				var esc = msg.trim();
				if (format_txt) {
					esc = hbai.convertMarkup(esc);
				}
				return esc;
			}
		}
	},
	convertMarkup: (msg) => {
		var esc = msg.trim();
		esc = esc.replace(/```[\n\r]*(.*?)[\n\r](.*?)```/gs, (f, l, c) => {
			c = c.replace(/[\n\r]+/g, "|codenl|");
			c = hbai.escapeHTML(c);
			return '<pre><code class="language-' + l.toLowerCase() + '">' + c + '</code></pre>';
		});
		esc = esc
			.replace(/`(.+?)`/gs, (f, m) => '<code>' + m.replace(/[\n\r]+/g, "|codenl|") + '</code>')
			.replace(/\*\*(.+?)\*\*/gs, (f, m) => '<strong>' + m + '</strong>')
			.replace(/##+ ?([^\n\r]+)/g, (f, m) => '<strong>' + m + '</strong>')
			.replace(/\b_(.+?)_\b/g, (f, m) => '<span style="font-style: italic;">' + m + '</span>')
			.replace(/[\n\r]+/g, "<br><br>")
			.replaceAll("|codenl|", "\n");
		return esc;
	},
	addOutput: (role, content, opts) => {
		opts = opts || { };
		let chat_type = opts.type || 'chat_basic';
		let bot_id = opts.bot || false
		let iterating = ("iter" in opts) && opts.iterLength && opts.iter < opts.iterLength - 1;
		let esc_html = chat_type == 'chat_basic' || chat_type == 'chat_file';
		let fmt_txt = chat_type == 'chat_basic' || chat_type == 'chat_file';
		hbai.removeTemp();
		if (role == "user") {
			esc_html = true;
			if (typeof content == 'object') {
				esc_html = false;
				for (var i = 0; i < content.length; i++) {
					if (content[i].type == 'text') {
						hbai.last_msg = content[i].text;
						break;
					}
				}
			} else {
				hbai.last_msg = content.trim();
			}
			hbai.last_reply = false;
			hbai.addUserMessage(hbai.formatMessage(content, true, false), esc_html);
			hbai.scrollToBottom();
		} else if (role == "assistant") {
			if (typeof hbai.simplefmt[chat_type] == 'function') {
				hbai.last_reply = content;
				hbai.addAssistantMessage(hbai.simplefmt[chat_type](content), bot_id, iterating);
			} else {
				var con = '';
				var has_sr = ['search_res', 'adult_chat', 'help_chat'];
				if (has_sr.includes(chat_type) || (chat_type == 'image_search')) {
					con = content.txt.trim();
				} else {
					con = content.trim();
				}
				hbai.last_reply = con;
				if (has_sr.includes(chat_type)) { 
					con = hbai.formatSearchResults(content.res, content.txt.trim(), content.query);
				} else if (chat_type == 'image_search') {
					con = hbai.formatImageResults(content.res, content.txt.trim());
				}
				hbai.addAssistantMessage(hbai.formatMessage(con, esc_html, fmt_txt), bot_id, iterating);
			}
		}
		if ((chat_type == 'image_gen') || ((role == 'user') && (typeof content == 'object'))) {
			hbai.onImage();
		}
		hbai.onChange();
		hbai.activity();
	},
	formatSearchResults: (sr, txt, q) => {
		var ret = '';
		if (typeof hbai.formatsr == 'function') {
			ret = hbai.formatsr(sr, txt, q);
		}
		return ret;
	},
	formatImageResults: (sr, txt) => {
		var ret = '';
		if (typeof hbai.formatimg == 'function') {
			ret = hbai.formatimg(sr, txt);
		}
		return ret;
	},
	devMsg: m => hbai.trigger("devmsg", m),
	onChange: () => hbai.trigger("change"),
	onReset: () => hbai.trigger("reset"),
	onNewChat: () => hbai.trigger("newchat"),
	onLoadChat: () => hbai.trigger("loadchat"),
	onJobType: t => hbai.trigger("jobtype", t),
	removeTemp: () => hbai.trigger("removetemp"),
	onImage: () => hbai.trigger("image"),
	addUserMessage: (m, e) => hbai.trigger("usermsg", m, e),
	addAssistantMessage: (m, b, iter) => hbai.trigger("asstmsg", m, b, iter),
	onConversationList: new_conv => hbai.trigger("convlist", hbai.histories, hbai.active_hist, new_conv),
	onSTT: txt => hbai.trigger("stt", txt),
	onTTS: dat => hbai.trigger("tts", dat),
	onTTSStart: id => hbai.trigger("ttsstart", id),
	onTTSChunk: (dat, id) => hbai.trigger("ttschunk", dat, id),
	onTTSEnd: id => hbai.trigger("ttsend", id)
};