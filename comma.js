var assign = Object.assign || function(a, b) {
  if(b) for(var k in b) a[k] = b[k];
  return a;
}

function Comma(opts, doc) {
	opts = assign({
		api: 'local'
	}, opts)
	this.doc = doc;
	this.cq = new CQuery(opts.jQuery, doc)

	this.opts = assign({
		log: (console && console.log && localStorage && localStorage.getItem('c-conductrics-debug') == 'true'),
		events: 'click mouseover change', // TODO - phase this out and just decorate with separate listeners?
		// Options to tweak what HTML attributes we look for
		agentAttribute: 'data-agent',
		textAttribute: 'data-text',
		swapAttribute: 'data-frag',
		goalAttribute: 'data-goal',
		goalOnAttribute: 'data-goal-on',
		// Options to tweak what CSS class names we look for
		variationClass: 'c-variation',
		defaultClass: 'c-default',
		doneClass: 'c-m-done',
		fallbackClass: 'c-m-fallback',
		agentParser: this.agentParser,
		goalParser: this.goalParser,
		// our recommeneded "fallback snippet" should be present with this id; we'll add a rudimentary one ourselves to control flicker if snippet not present (see #420)
		styleId: 'c-ms',
		// Options for AJAX
		ajaxTimeout: 3000, // timeout for AJAX calls to server-side API, in milliseconds
		// Options for cookies
		cookies: true,
		cookieName: 'cp-id',
		// Option for local vs AJAX style
		api: 'local'
	}, opts);

	if( Conductrics && Conductrics.ClientApi && opts.api instanceof Conductrics.ClientApi ) {
		this.exec = this._exec_local
	} else if( opts.api == 'local' ) {
		this.exec = this._exec_local
		opts.api = new Conductrics.ClientApi()
	} else if( 'string' == typeof opts.api ) {
		this.exec = this._exec_ajax
	} else throw new Error("Unknown executor")

	this.addListeners()
}

function valid_code(s) { return s && ('string' == typeof s) && s.length > 0; }

assign( Comma.prototype, {
	find: function() { return { agents: this.findAgents() } },
	findAgents: function() {
		var agents = Object.create(null),
			opts = this.opts,
			prefixes = [ opts.textAttribute + "-", opts.swapAttribute + "-" ],
			selected = this.cq.select("["+opts.agentAttribute+"]"),
			p, a, v, el, v_add, i, j, k;
		for(i = 0; i < selected.length; i++) {
			p = opts.agentParser(el = selected[i]), a = p.a, v = p.v;
			if( ! valid_code(a) ) {
				this.log("Invalid agent code:" + a);
				return;
			}
			agents[a] = agents[a] || { variations: { } }
			v_add = function(v) {
				v = v.toLowerCase();
				if( ! valid_code(v) ) {
					this.log("Invalid variation code: " + v + " specified for agent: " + a)
					return;
				}
				(agents[a].variations[v] = agents[a].variations[v] || { els: [ ] }).els.push(el)
			}
			v_add(v);
			for( j = 0; j < el.attributes.length; j++) {
				for( k = 0; k < prefixes.length; k++) {
					v_add(el.attributes[j].name.split(prefixes[k])[1])
				}
			}
			this.cq.addClass(el, opts.variationClass);
			this.log("Found element for agent "+a+":", el)
		}
		return agents;
	},
	process: function(cb) {
		var opts = this.options, // less generated code using "opts" as an alias
			found, commands, cb = cb || function(){}
		
		// our recommeneded "fallback snippet" should be present with this id; we'll add a rudimentary one ourselves to control flicker if snippet not present (see #420)
		if( this.cq.select("style#"+opts.styleId).length == 0 ) {
			this.cq.addStyleTag("."+opts.variationClass+" {display: none !important}", opts.styleId)
		}

		this.cq.ready(function() {
			// bail if the body has been tagged with .c-markup-fallback, which is an indication that outside process has decided we shouldn't run
			if( this.cq.select("html."+opts.fallbackClass).length > 0 ) {
				this.log("Aborting due to "+opts.fallbackClass)
				return cb()
			}
			// find agents, goals, etc
			found = this.find()
			commands = []
			for( k in found.agents ) {
				commands.push({ a: found.agents[k] })
			}

			this.exec(commands, function(err, res) {
				if( err ) return cb(err)
				this.applySelections( res ? res.sels : null, found )
				this.onDocLoad( found )
				// add '.c-markup-done' to the <body> so we know we've done our work
				this.cq.addClass(this.doc.documentElement, opts.doneClass)
				cb()
			})
		});
		return
	},
	addListeners: function() {
		var e = this.options.events.split(' '), i = 0;
		for(; i < e.length; i++) {
			this.doc.addEventListener(e[i], this.onEvent);
		}
	},
	removeListeners: function() {
		var e = this.options.events.split(' '), i = 0;
		for(; i < e.length; i++) {
			this.doc.removeEventListener(e[i], this.onEvent);
		}
	},
	onEvent: function(ev) {
		var p, g, e, v,
			ev = (ev || window.event), // for older IE
			p = this.options.goalParser(ev.target), // read relevant stuff off the element
			g = p.g, e = p.e, v = p.v;
		if( 'string' == typeof v ) v = parseFloat(v)
		if( ! isFinite(v) ) v = undefined
		if( (e == ev.type) && valid_code(g) ) {
			this.log("Goal '"+g+"' detected (value "+(v || 'default')+")")
			this.exec([ { g:g, v:v } ], function(err, res){})
		}
	},
	onDocLoad: function(found) {
		var sel = this.cq.select("[data-goal-on='load']"), i = 0;
		for(; i < sel.length; i++) {
			this.onEvent({ type: 'load', target: sel[i] })
		}
	},
	applySelections: function(sels, found) {
		var opts = this.options, // less generated code using "opts" as an alias
			sels = sels || {},
			i, a, a_item, sel, v_item, els, el, from_el, attr
		for( a in found.agents ) {
			a_item = found.agents[a]
			if( sel = sels[a] ) sel = sel.toLowerCase() // what variation code was selected?
			// fallback if we got an unexpected selection
			if( ! (sel in a_item.variations) ) sel = Object.keys(a_item.variations)[0] // first variation
			// corresponding "found" object for the agent selection
			v_item = a_item.variations[sel]
			if( ! (els = v_item.els) ) return;
			// showing
			for( i = 0; i < els.length; i++) {
				if( el.hasAttribute(attr = opts.textAttribute+"-"+sel) ) {
					this.cq.textSet(el, el.getAttribute(attr))
				}
				if( el.hasAttribute(attr = opts.swapAttribute+"-"+sel) ) {
					if( from_el = document.getElementById(el.getAttribute(attr)) ) {
						this.cq.htmlSet(el, from_el.innerText)
					}
				}
				this.show( el )
			}
		}
	},
	show: function(el) {
		this.cq.removeClass(el, this.options.variationClass)
	},
	sessionId: function() {
		var opts = this.options // less generated code using "opts" as an alias
		if( opts.session ) return opts.session
		if( opts.cookie ) {
			name = opts.cookieName
			sid = this.cq.cookieGet( name )
			if( sid ) return sid
			sid = 'cs-' + Math.round(Math.random()*1000000)
			this.cq.cookieSet(name, sid, 
				opts.cookiePath, // ok if not specified
				opts.cookieDomain, // ok if not specified
				opts.cookieMaxAge // ok if not specified
			)
			return sid
		}
	},
	_exec_local: function(commands, cb) {
		if( (!commands) || commands.length == 0 ) return cb();
		var api = this.options.api || new Conductrics.ClientApi()
		api.exec(commands, cb)
	},
	_exec_ajax: function(commands, cb) {
		session = this.sessionId()
		url = this.options.api+"&session="+(escape(session))
		handler = function(data) { return cb(false, data ? data.data : null) }

		this.cq.ajax({
			method: 'post',
			url: url,
			timeout: this.options.ajaxTimeout,
			data: JSON.stringify({commands:commands}),
			contentType: 'text/plain',
			dataType: 'json',
			success: handler,
			error: handler
		})
	},
	agentParser: function(el) { // default "agent parser" - get agent and variation codes from element
		var a, attr, ret = { a: '', v: null }
		if( el && el.getAttribute ) {
			a = (el.getAttribute(this.options.agentAttribute) || '').split(' ')
			ret.a = a[0]
			ret.v = a[1]
		}
		return ret;
	},
	goalParser: function(el) { // default "goal parser" - get goal code and (optional) numeric reward from element
		var a, attr, ret = { g: '', v: null, e: 'click' }
		if( el && el.getAttribute ) {
			a = (el.getAttribute(this.options.goalAttribute) || '').split(' ')
			ret.g = a[0]
			ret.v = a[1]
			ret.e = el.getAttribute(this.options.goalOnAttribute) || 'click'
		}
		return ret
	},
	log: function() {
		if( ! this.options.log ) return;
		console.log.apply(console, arguments);
	}

})

/* class CQuery */
function CQuery(jq, doc) {
  this.jq = jq;
  this.doc = doc || document;
}

function createRequest(url, method) {
  var xhr = null,
    method = method || "GET";
  if( ! XMLHttpRequest ) return null;
  xhr = new XMLHttpRequest();
  if( xhr.withCredentials != null ) {
    xhr.open(method, url, true);
  } else if( XDomainRequest ) {
    xhr = new XDomainRequest();
    xhr.open(method, url.replace(/^https*:/,''));
  }
  return xhr;
}

var defaultDisplayMap = Object.create(null);
function getDefaultDisplay(el) {
  var doc = el.ownerDocument,
    name = el.nodeName;
  if( name in defaultDisplayMap ) {
    return defaultDisplayMap[name];
  } else {
    var temp = doc.body.appendChild(doc.createElement(name)),
      display = this.styleGet( temp, 'display' );
    temp.parentNode.removeChild(temp);
    return defaultDisplayMap[ name ] = (display == 'none' ? 'block' : display);
  }
}

assign( CQuery.prototype, {
  select: function(sel) { return (this.jq ? this.jq : this.doc.querySelectorAll)(sel) },
  addClass: function(el, c) {
    if ( !el ) return;
    if ( el.classList ) { el.classList.contains(c) || el.classList.add(c) }
    else if( this.jq ) this.jq.addClass(c)
    else el.className += ' ' + c
  },
  removeClass: function(el, c) {
    if ( !el ) return;
    if ( el.classList ) el.classList.remove(c)
    else if( this.jq ) this.jq.removeClass(c)
    else el.className = el.className.replace(new RegExp('(^|\\b)' + c.split(' ').join('|') + '(\\b|$)', 'gi'), ' ')
  },
  ready: function(cb) {
    if ( !cb ) return;
    if ( this.jq ) return this.jq.ready(cb)
    var doc = this.doc,
      check_ready = function() { if( doc.readyState == 'complete' || doc.readyState == 'interactive') { cb(); return true; } };
    check_ready() ||
      ( doc.attachEvent ? doc.attachEvent("onreadystatechange", check_ready) : false ) ||
      ( doc.addEventListener("DOMContentLoaded", check_ready) );
  },
  addStyleTag: function(css, id) {
    if( this.jq ) return this.jq('head').append("<style type='text/css' id='" + id + "'>" + css + "</style>")
    var style = document.create("style")
    style.id = id
    style.type = 'text/css'
    if( style.styleSheet ) style.styleSheet.cssText = css
    else style.appendChild(document.createTextNode(css));
  },
  show: function(el) {
    if( this.jq ) this.jq(el).show()
    else this.styleSet(el, 'display', getDefaultDisplay(el));
  },
  cookieGet: function(key) {
    return decodeURIComponent(document.cookie.replace(new RegExp("(?:(?:^|.*;)\\s*" + encodeURIComponent(key).replace(/[\-\.\+\*]/g, "\\$&") + "\\s*\\=\\s*([^;]*).*$)|^.*$"), "$1")) || null;
  },
  cookieSet: function(name, value, path, maxAge, domain) {
    path = path || '/';
    maxAge = maxAge || 31536000;
    document.cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) +
      ";path=" + path +
      (domain ? ';domain='+domain : '') +
      (maxAge ? ';max-age='+maxAge : '')
  },
  styleGet: function(el, name) {
    return (this.jq ? this.jq(el).css(name) :
      el.getComputedStyle ? el.getComputedStyle(name) :
      el.currentStyle ? el.currentStyle[name] :
      el.style ? el.style[name] : null)
  },
  styleSet: function(el, name, value) {
    this.jq ? this.jq(el).css(name, value) :
    el.style ? (el.style[name] = value) : null;
  },
  textSet: function(el, str) {
    this.jq ? this.jq(el).text(str) : (el.innerText = str);
  },
  htmlSet: function(el, str) {
    this.jq ? this.jq(el).html(str) : (el.innerHTML = str);
  },
  ajax: function(options) {
    if( this.jq ) {
      if( options.method ) options.type = options.method;
      return this.jq.ajax(options)
    }
    var req = createRequest(options.url, options.method || options.type);
    if( "function" == typeof options.success )
      req.onload = options.success
    if( "function" == typeof options.error ) {
      req.onerror = options.error
      req.ontimeout = option.error
    }
    if( "number" == typeof options.timeout ) {
      req.timeout = options.timeout;
    }
    req.send(JSON.stringify(options.data))
    return req;
  }
})

if( ! ("undefined" == typeof window ) ) {
	window.Conductrics = window.Conductrics || {}
	window.Conductrics.Comma = Comma
}
if( ! ("undefined" == typeof define ) ) define(['Comma'], Comma)
if( ! ("undefined" == typeof module ) ) module.exports = Comma
