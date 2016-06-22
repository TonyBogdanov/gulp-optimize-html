var fs                      = require('fs');
var path                    = require('path');
var File                    = require('vinyl');

var cheerio                 = require('cheerio');
var cssnano                 = require('cssnano');
var uglifyjs                = require('uglify-js');
var htmlmin                 = require('html-minifier');

const PLUGIN_NAME           = 'gulp-optimize-html';

function gulpOptimizeHtml(options) {
    options                 = (function(defaults, options) {
        for(var k in defaults) {
            if('undefined' != typeof options[k]) {
                defaults[k] = options[k];
            }
        }
        return defaults;
    })({
        verbose:                false,
        minifyHtml:             true,
        minifyCss:              true,
        minifyJs:               true,
        minifyInlineCss:        true,
        minifyInlineJs:         true,
        minifyExternals:        true,
        followExternals:        true,
        ignoreExternals:        [],
        stripIgnoredExternals:  true,
        followImports:          true,
        ignoreImports:          [],
        stripIgnoredImports:    true
    }, options || {});

    var walk                = function(collection, apply, cb) {
        var remain          = collection.length;
        var tryToFinish     = function() {
            if(0 == remain) {
                cb();
            }
        };
        if(0 == remain) {
            cb();
        } else if('function' == typeof collection.each) {
            collection.each(function() {
                apply.call(this, function() {
                    remain--;
                    tryToFinish();
                });
            });
        } else if('function' == typeof collection.forEach) {
            collection.forEach(function(e) {
                apply.call(e, function() {
                    remain--;
                    tryToFinish();
                });
            });
        }
    };

    var minifyCSS           = function(css, cb) {
        cssnano.process(css).then(function(result) {
            cb(result.css);
        });
    };
    var minifyJS            = function(js, asString, cb) {
        cb(uglifyjs.minify(js, {fromString: true === asString}).code);
    };

    var processAnyFile      = function(file, encoding, cb) {
        switch(path.extname(file.path).toLowerCase()) {
            case '.html':
                processHTMLFile(file, encoding, cb);
                break;

            case '.css':
                if(options.minifyCss) {
                    processCSSFile(file, encoding, cb);
                } else {
                    cb();
                }
                break;

            case '.js':
                if(options.minifyJs) {
                    processJSFile(file, encoding, cb);
                } else {
                    cb();
                }
                break;

            default:
                cb();
        }
    };
    var processHTMLFile     = function(file, encoding, cb) {
        var $               = cheerio.load(file.contents);
        var finalHTML       = null;

        var followImports   = function() {
            if(!options.followImports) {
                return followExternals();
            }
            walk($('link[rel="import"][href$=".html"]'), function(walkEnd) {
                var url     = path.resolve(path.dirname(file.path), $(this).attr('href'));

                if(-1 < options.ignoreImports.indexOf(url)) {
                    if(options.verbose) {
                        console.log('Ignoring HTML import', path.relative(process.cwd(), url));
                    }
                    if(options.stripIgnoredImports) {
                        $(this).remove();
                        if(options.verbose) {
                            console.log('Stripping ignored HTML import', path.relative(process.cwd(), url));
                        }
                    }
                    return walkEnd();
                }

                if(options.verbose) {
                    console.log('Following HTML import', path.relative(process.cwd(), url));
                }
                fs.readFile(url, encoding, function(e, data) {
                    if(e) {
                        throw e;
                    }
                    processAnyFile(new File({
                        cwd:        process.cwd(),
                        base:       path.dirname(url),
                        path:       url,
                        contents:   new Buffer(data)
                    }), encoding, walkEnd);
                });
            }, function() {
                followExternals();
            });
        };
        var followExternals = function() {
            if(!options.followExternals) {
                return inlineCSS();
            }
            walk($('link[rel="stylesheet"][href$=".css"], style[src$=".css"], script[src$=".js"]'), function(walkEnd) {
                var url     = path.resolve(path.dirname(file.path),
                    $(this).attr('link' == this.tagName.toLowerCase() ? 'href' : 'src'));

                if(-1 < options.ignoreExternals.indexOf(url)) {
                    if(options.verbose) {
                        console.log('Ignoring external', path.relative(process.cwd(), url));
                    }
                    if(options.stripIgnoredExternals) {
                        $(this).remove();
                        if(options.verbose) {
                            console.log('Stripping ignored external', path.relative(process.cwd(), url));
                        }
                    }
                    return walkEnd();
                }

                if(options.verbose) {
                    console.log('Following external', path.relative(process.cwd(), url));
                }
                fs.readFile(url, encoding, function(e, data) {
                    if(e) {
                        throw e;
                    }
                    processAnyFile(new File({
                        cwd:        process.cwd(),
                        base:       path.dirname(url),
                        path:       url,
                        contents:   new Buffer(data)
                    }), encoding, walkEnd);
                });
            }, function() {
                inlineCSS();
            });
        };
        var inlineCSS       = function() {
            if(!options.minifyInlineCss) {
                return inlineJS();
            }
            walk($('style'), function(walkEnd) {
                var $this   = $(this);
                var css     = $this.html();

                if(0 == css.length) {
                    walkEnd();
                } else {
                    if(options.verbose) {
                        console.log('Minifying inline CSS block in', path.relative(process.cwd(), file.path));
                    }
                    minifyCSS(css, function(result) {
                        $this.html(result);
                        walkEnd();
                    });
                }
            }, function() {
                inlineJS();
            });
        };
        var inlineJS        = function() {
            if(!options.minifyInlineJs) {
                return inlineHTML();
            }
            walk($('script'), function(walkEnd) {
                var $this   = $(this);
                var js      = $this.html();

                if(0 == js.length) {
                    walkEnd();
                } else {
                    if(options.verbose) {
                        console.log('Minifying inline JS block in', path.relative(process.cwd(), file.path));
                    }
                    minifyJS(js, true, function(result) {
                        $this.html(result);
                        walkEnd();
                    });
                }
            }, function() {
                inlineHTML();
            });
        };
        var inlineHTML      = function() {
            if(!options.minifyHtml) {
                return finish();
            }
            if(options.verbose) {
                console.log('Minifying HTML in', path.relative(process.cwd(), file.path));
            }
            finalHTML       = htmlmin.minify($.html(), {
                caseSensitive:                              true,
                collapseBooleanAttributes:                  true,
                collapseWhitespace:                         true,
                keepClosingSlash:                           true,
                removeComments:                             true,
                removeRedundantAttributes:                  true,
                removeScriptTypeAttributes:                 true,
                removeStyleLinkTypeAttributes:              true
            });
            finish();
        };
        var finish          = function() {
            fs.writeFile(file.path, finalHTML, {encoding: encoding}, cb);
        };

        followImports();
    };
    var processCSSFile      = function(file, encoding, cb) {
        fs.readFile(file.path, encoding, function(e, data) {
            if(e) {
                throw e;
            }
            if(options.verbose) {
                console.log('Minifying CSS in', path.relative(process.cwd(), file.path));
            }
            minifyCSS(data, function(result) {
                fs.writeFile(file.path, result, {encoding: encoding}, cb);
            });
        });
    };
    var processJSFile       = function(file, encoding, cb) {
        if(options.verbose) {
            console.log('Minifying JS in', path.relative(process.cwd(), file.path));
        }
        minifyJS(file.path, false, function(result) {
            fs.writeFile(file.path, result, {encoding: encoding}, cb);
        });
    };

    var stream              = new (require('stream').Transform)({objectMode: true});
    stream._transform       = function(file, encoding, cb) {
        if(file.isNull()) {
            return cb(null, file);
        }
        if(file.isStream()) {
            return cb(new PluginError(PLUGIN_NAME, 'Streaming not supported'));
        } else if(file.isBuffer()) {
            processAnyFile(file, encoding, cb);
        }
    };
    return stream;
}
module.exports              = gulpOptimizeHtml;