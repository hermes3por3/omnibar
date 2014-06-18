const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;
const ACR = Ci.nsIAutoCompleteResult;

//FF3 only method.
//http://developer.mozilla.org/En/How_to_Build_an_XPCOM_Component_in_Javascript
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const log = function(msg) {
  Cc["@mozilla.org/consoleservice;1"].getService(Ci.nsIConsoleService).logStringMessage('OM:'+msg);
}

const PREF_BRANCH = Cc["@mozilla.org/preferences-service;1"].
getService(Ci.nsIPrefService).getBranch("extensions.omnibar.").QueryInterface(Ci.nsIPrefBranch2);

function OmnibarSearch() {
  var localeService = Cc["@mozilla.org/intl/nslocaleservice;1"]
                      .getService(Ci.nsILocaleService);
  var stringBundleService = Cc["@mozilla.org/intl/stringbundle;1"]
                            .getService(Ci.nsIStringBundleService);
  this._sb = stringBundleService.createBundle(
              "chrome://omnibar/locale/strings.properties",
              localeService.getApplicationLocale());
};

OmnibarSearch.prototype = {
  classDescription: "omnibar search companion",
  classID:          Components.ID("{629F60A2-7C31-11DD-9566-E35956D89593}"),
  contractID:       "@mozilla.org/autocomplete/search;1?name=omnibar-search",
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAutoCompleteSearch]),
  createNewResult: function(searchString) {
    var result = Cc['@mozilla.org/autocomplete/simple-result;1']
                  .createInstance(Ci.nsIAutoCompleteSimpleResult);
    result.setSearchString(searchString);
    result.setDefaultIndex(-1);
    result.setErrorDescription("omnibar search failure");
    result.setSearchResult(Ci.nsIAutoCompleteResult.RESULT_SUCCESS);
    return result;
  },
  startSearch: function(searchString, searchParam, previousResult, listener) {
  },
  stopSearch: function() {
  }
}

/**
 * another component class to enable detailed search which are shown at the end
 * of the normal places results.
 */
DetailedOmnibarSearch = function() {
  OmnibarSearch.call(this);
  this.init();
}

DetailedOmnibarSearch.prototype = {
  classDescription: "Firefox Search component for location bar",
  classID:          Components.ID("{AA5CDC32-8148-11DD-99E5-B6AA56D89593}"),
  contractID:       "@mozilla.org/autocomplete/search;1?name=omnibar-search-suggestions",
  __proto__: OmnibarSearch.prototype,
  
  init: function() {
    this._autoComplete = Cc["@mozilla.org/autocomplete/search;1?name=search-autocomplete"]
                                .createInstance(Ci.nsIAutoCompleteSearch);
    this._utils = new SearchUtils();
  },
  isSuggestEnabled: function() {
    var prefBranch = Cc["@mozilla.org/preferences-service;1"]
                        .getService(Ci.nsIPrefBranch);
    var engine = this._utils._ss.currentEngine;
    return prefBranch.getBoolPref("browser.search.suggest.enabled") && engine.supportsResponseType("application/x-suggestions+json");
  },
  startSearch: function(searchString, searchParam, previousResult, listener) {
    //log('startSearch', searchString);
    var self = this;
    this._listener = listener;
    this._searchString = searchString;
    var utils = this._utils;
    var query = this._query = utils.parseQuery(searchString);
    // load the preference baranch. will use it for a bunch of operations.
    var prefs = utils._prefBranch;
    var kwdInfo = utils.getKeywordInfo(searchString.split(' ')[0]);

    this.stopSearch();
    this._result = this.createNewResult(searchString);

    if(this.isSuggestEnabled() && 
        (prefs.getBoolPref('enabledefaultsearch') || query[3] || query[4])) {
      var restoreEngine = null, engines = query[1] || [];
      engines.some(function(engine) {
        if (engine.supportsResponseType('application/x-suggestions+json')) {
          restoreEngine = utils._ss.currentEngine;
          utils._ss.currentEngine = engine;
          return true;
        }
      });
      this._autoComplete.startSearch(query[0] || searchString, searchParam,
                                     null, new SearchObserver({
                                      onSearchResult: function(search, result) {
                                        self.onSuggestedResult(search, result);
                                      }
                                    }));
      if (restoreEngine) {
        utils._ss.currentEngine = restoreEngine;
      }
    } else {
      this.sendCancelledSearchResult(listener);
    }
  },
  sendCancelledSearchResult: function(listener) {
    //log('sendCancelledSearchResult');
    try {
      var self = this;
      //RESULT_NOMATCH_ONGOING,RESULT_FAILURE,RESULT_NOMATCH,RESULT_SUCCESS_ONGOING
      Cc["@mozilla.org/thread-manager;1"]
      .getService(Ci.nsIThreadManager).mainThread.dispatch({
        run: function() {
          try {
            self._result.setSearchResult(Ci.nsIAutoCompleteResult.RESULT_NOMATCH);
            listener.onSearchResult(self, self._result);
          } catch(e){
            log(e)
          }
        }
      }, Ci.nsIThread.DISPATH_NORMAL);
    } catch(e){
      log(e)
    }
  },
  stopSearch: function() {
    this._autoComplete.stopSearch();
  },
  /**
   * called after the suggested search results have been found.
   */
  onSuggestedResult: function(search, suggested_result) {
    var result = this._result;
    var utils = this._utils;
    var searchString = this._searchString;
    var query = this._query;
    var listener = this._listener;
    var prefs = utils._prefBranch;
    var format = query[2] || prefs.getCharPref("defaultqueryformat");
    var defaultEngines = query[1];
    var count = Math.min(prefs.getIntPref("numsuggestions"),
                         suggested_result ? suggested_result.matchCount : 0);
    if(!(defaultEngines && defaultEngines.length > 0)) {
      defaultEngines = [utils._ss.currentEngine];
    }

    var
    $E$ = defaultEngines.map(function(e) { return e.name }).join(","),
    $Q$,
    iconURI = defaultEngines.length === 1 ?
                defaultEngines[0].iconURI.spec :
                "chrome://omnibar/skin/classic/magnifier.png";

    for(var i = 0; i < count; i++) {
      //    1. the actual string to be used in the urlbar.
      //    2. comment to be shown for the string in the urlbar.
      //    3. path to the image to be shown besides the comment.
      //    4. item's style
      $Q$ = suggested_result.getValueAt(i);
      var comment;
      if(utils.isAProtocolOrLocation($Q$)) {
        result.appendMatch($Q$,
                           $Q$,
                           utils.getIconSpec($Q$),
                           "omnibar-suggestion-url");
      } else {
        comment = this._sb ? this._sb.GetStringFromName("PhraseSuggestCommentFormat") :
                             "search $1 for $2"
        result.appendMatch(trim(format.replace("$Q$", $Q$).replace("$E$", $E$)),
                           comment.replace("$1", $E$).replace("$2", $Q$),
                           iconURI,
                           "omnibar-suggestion-phrase");
      }
    }

    listener.onSearchResult(this, result);
  }
}

// our implementation of nsIAutoCompleteObserver
SearchObserver = function(owner) {
  this.owner = owner;
}

SearchObserver.prototype = {
  QueryInterface: function(iid) {
    if(iid === Ci.nsIAutoCompleteObserver
       || iid === Ci.nsISupports) {
      return this;
    }
    throw Components.results.NS_ERROR_NO_INTERFACE;
  },
  onSearchResult: function(search, result) {
    this.owner.onSearchResult(search, result);
  }
}

// omnibar-allinone
OmnibarAllInOne = function() {
  OmnibarSearch.call(this);
  this.init();
}

OmnibarAllInOne.prototype = {
  classDescription: "Firefox Search and History component for location bar",
  classID:          Components.ID("{4087d5ad-ab64-4314-8899-fb9ccd7afe41}"),
  contractID:       "@mozilla.org/autocomplete/search;1?name=omnibar-allinone",
  __proto__: OmnibarSearch.prototype,
  
  init: function() {
    // do any init here if required.
    this.mainPrefs = Cc["@mozilla.org/preferences-service;1"]
                      .getService(Ci.nsIPrefBranch);
    this.prefs = Cc["@mozilla.org/preferences-service;1"]
                        .getService(Ci.nsIPrefService)
                        .getBranch("extensions.omnibar.");
    this.utils = new SearchUtils();
    this.omnibarSearch = new DetailedOmnibarSearch();
    this.historySearch = Cc["@mozilla.org/autocomplete/search;1?name=history"].createInstance(Ci.nsIAutoCompleteSearch);
    this.hiddenWindow = Cc["@mozilla.org/appshell/appShellService;1"]
                        .getService(Ci.nsIAppShellService).hiddenDOMWindow;
    this.observerService = Cc["@mozilla.org/observer-service;1"]
                           .getService(Ci.nsIObserverService);
  },
  query: null,
  listener: null,
  searchString: null,
  historySearchOn: false,
  omnibarSearchOn: false,
  searchTimer: 0,
  startSearch: function(searchString, searchParam, previousResult, listener) {
    //log('startSearch', searchString, searchParam, previousResult && previousResult.matchCount);
    var utils = this.utils;
    var me = this;
    this.listener = listener;
    this.searchString = searchString;
    // query === [search_str, engines, user_format, isKeyword, hasOperator]
    var query = this.query = utils.parseQuery(searchString);
    var resultDisplayStrategy = "HISTORY";
    if(query.length > 0 && (query[3] || query[4])) {
      resultDisplayStrategy = "OMNIBAR";
    } else if(trim(searchString).indexOf(" ") > 0) {
      resultDisplayStrategy = "OMNIBAR+HISTORY";
    }
    //log("startSearch: " + searchString);
    var result = this.result = new CompositeAutoCompleteResult(searchString, resultDisplayStrategy);
    if(query.length == 0 || (!query[3] && !query[4])) {
      // perform a history search only when a search engine keyword is not used
      // and search engine operator is not used
      result.setHistorySearchOn(true);
      this.historySearch.startSearch(searchString, searchParam,
                                     previousResult, new SearchObserver({
                                      onSearchResult: function(search, result) {
                                        me.onHistoryResult(search, result);
                                      }
                                    }));
    }
    if((query[3] || query[4] || this.prefs.getBoolPref('enabledefaultsearch'))) {
      result.setOmnibarSearchOn (true);
      var searchDelay = this.prefs.getIntPref('searchdelay');
      function search(){
        me.searchTimer = 0;
        var searchObserver = new SearchObserver({
          onSearchResult: function(search, result){
            me.onOmnibarResult(search, result);
          }
        });
        me.omnibarSearch.startSearch(searchString,
                                     searchParam,
                                     previousResult,
                                     searchObserver);
      }
      me.searchTimer = me.hiddenWindow.setTimeout(search,searchDelay);
    }
  },
  onHistoryResult: function(search, history_result) {
    //log('onHistoryResult:'+history_result.searchResult + ':' +history_result.matchCount)
    var result = this.result, self = this;
    result.setHistoryResult(history_result);
    if(this.resultTimeoutId) {
        this.hiddenWindow.clearTimeout(this.resultTimeoutId);
    }
    // Assuming that search suggestions load later
    this.resultTimeoutId = this.hiddenWindow.setTimeout(onSearchResult, 100);
    function onSearchResult() {
        self.listener.onSearchResult(self, result);
    }
    //log('done onHistoryResult:'+result.searchResult + ':' +result.matchCount)
  },
  onOmnibarResult: function(search, omnibar_result) {
    //log('onOmnibarResult:'+omnibar_result.searchResult + ':' +omnibar_result.matchCount)
    var result = this.result;
    result.setOmnibarResult(omnibar_result);
    this.listener.onSearchResult(this, result);
    if(this.resultTimeoutId) {
        this.hiddenWindow.clearTimeout(this.resultTimeoutId);
    }
    //this.observerService.notifyObservers(null, "places-autocomplete-feedback-updated", "");
  },
  stopSearch: function() {
    //log('stopSearch');
    //this.historySearch.stopSearch();
    //this.omnibarSearch.stopSearch();
    if(this.searchTimer) {
      this.hiddenWindow.clearTimeout(this.searchTimer);
    }
  }
}

var MAX = 40;
var OMNIBAR = 'O', HISTORY = 'H';
const DISTRIBUTION = {
  "OMNIBAR": [[OMNIBAR, MAX]],
  "OMNIBAR+HISTORY": [[OMNIBAR, 2], [HISTORY, 4], [OMNIBAR, 4], [HISTORY, MAX]],
  "HISTORY": [[HISTORY, MAX], [OMNIBAR, MAX]]
};

const DISTRIBUTION_STRATEGIES = {};

function setHistoryCount(aSubject, aTopic, aData){
  var numhistory = PREF_BRANCH.getIntPref('numhistory');
  //log("numhistory is " + numhistory);
  DISTRIBUTION.HISTORY[0][1] = numhistory;

  for(let name in DISTRIBUTION) {
    var array = [], strategy = DISTRIBUTION[name];
    for(let i = 0, len = strategy.length; i < len; i += 1) {
      var sourceAndBlock = strategy[i];
      var source = sourceAndBlock[0];
      for(let i = 0, len = sourceAndBlock[1]; i < len; i +=1) {
        array.push(source);
      }
    }
    DISTRIBUTION_STRATEGIES[name] = array;
  }

}

// Implements nsIAutoCompleteResult
function SimpleAutoCompleteResult(searchString, searchResult,
                                  defaultIndex, errorDescription,
                                  results, comments, styles, images) {
  this.searchString = searchString;
  this.searchResult = searchResult;
  this.defaultIndex = defaultIndex;
  this.errorDescription = errorDescription;
  this.results = results;
  this.comments = comments;
  this.styles = styles;
  this.images = images;
}

SimpleAutoCompleteResult.prototype = {
  searchString: "",
  searchResult: 0,
  defaultIndex: 0,
  errorDescription: "",
  results: [],
  comments: [],
  styles: [],
  images: [],

  get matchCount() {
    return this.results.length;
  },
  getValueAt: function(index) {
    return this.results[index];
  },
  getCommentAt: function(index) {
    return this.comments[index];
  },
  getStyleAt: function(index) {
    return this.styles[index];
  },
  getImageAt : function (index) {
    return this.images[index];
  },
  removeValueAt: function(index, removeFromDb) {
    this.results.splice(index, 1);
    this.comments.splice(index, 1);
    this.styles.splice(index, 1);
    this.images.splice(index, 1);
  },
  QueryInterface: function(aIID) {
    if (!aIID.equals(Ci.nsIAutoCompleteResult) && !aIID.equals(Ci.nsISupports))
        throw Components.results.NS_ERROR_NO_INTERFACE;
    return this;
  }
};

// nsIAutoCompleteResult
function CompositeAutoCompleteResult(searchString, strategy) {
  this.searchString = searchString;
  this.strategy = strategy = strategy ||  "HISTORY";
}

CompositeAutoCompleteResult.prototype = {
  strategy: "OMNIBAR",
  searchString: "",
  get searchResult() {
    var omnibarResult = this.omnibarResult;
    var historyResult = this.historyResult;
    var matchCount = this._matchCount;
    if(this.omnibarSearchOn && (!omnibarResult ||
       omnibarResult.searchResult == ACR.RESULT_SUCCESS_ONGOING)) {
      if(this.matchCount == 0) return ACR.RESULT_NOMATCH_ONGOING;
      else return ACR.RESULT_SUCCESS_ONGOING;
    }
    if(this.historySearchOn && (!historyResult ||
       historyResult.searchResult == ACR.RESULT_SUCCESS_ONGOING)) {
      if(this.matchCount == 0) return ACR.RESULT_NOMATCH_ONGOING;
      else return ACR.RESULT_SUCCESS_ONGOING;
    }
    //log("return ACR.RESULT_SUCCESS");
    return ACR.RESULT_SUCCESS;
  },
  omnibarSearchOn: false,
  setOmnibarSearchOn: function(omnibarSearchOn){
    this.omnibarSearchOn = omnibarSearchOn;
  },
  historySearchOn: false,
  setHistorySearchOn: function(historySearchOn) {
    this.historySearchOn = historySearchOn;
  },
  defaultIndex: 0,
  _errorDescription: null,
  displayTemplateItems: [],
  get errorDescription() {
    return this._errorDescription || (this.historyResult ? this.historyResult.errorDescription : "<Not Available>");
  },
  omnibarResult: null,
  historyResult: null,
  setOmnibarResult: function(result) {
    this.omnibarResult = result;
    this._update();
  },
  setHistoryResult: function(result) {
    //for(var i = 0; i < result.matchCount; i += 1) {
      //log('result ' + i + ':' + result.getValueAt(i) + ':' + result.getCommentAt(i) + ':' + result.getStyleAt(i) + ':' + result.getImageAt(i));
    //}
    this.historyResult = result;
    this._update();
  },
  _update: function() {
    try{
    var displayTemplateItems = DISTRIBUTION_STRATEGIES[this.strategy].slice(),
        compositeResult  = new Array(displayTemplateItems.length),
        omnibar_count = 0,
        history_count = 0,
        omnibarResult = this.omnibarResult,
        historyResult = this.historyResult,
        omnibar_max = omnibarResult ? omnibarResult.matchCount : 0,
        history_max = historyResult ? historyResult.matchCount : 0,
        max = Math.min(MAX, omnibar_max + history_max);
    this._matchCount = max;
    
    for(var i = 0; i < max; i += 1) {
      if(omnibar_max <= omnibar_count) {
        displayTemplateItems.splice(i);
        for(var j = i; j < max; j += 1) {
        compositeResult[j] = [historyResult.getValueAt(history_count),
                              historyResult.getCommentAt(history_count),
                              historyResult.getStyleAt(history_count),
                              historyResult.getImageAt(history_count),
                              HISTORY,
                              history_count
                              ];
          history_count += 1;
        }
        break;
      } else if(history_max <= history_count) {
        for(var j = i; j < max; j += 1) {
        compositeResult[j] = [omnibarResult.getValueAt(omnibar_count),
                              omnibarResult.getCommentAt(omnibar_count),
                              omnibarResult.getStyleAt(omnibar_count),
                              omnibarResult.getImageAt(omnibar_count),
                              OMNIBAR,
                              omnibar_count
                              ];
          omnibar_count += 1;
        }
        break;
      }
      var src = displayTemplateItems[i];
      if(src == OMNIBAR) {
        compositeResult[i] = [omnibarResult.getValueAt(omnibar_count),
                              omnibarResult.getCommentAt(omnibar_count),
                              omnibarResult.getStyleAt(omnibar_count),
                              omnibarResult.getImageAt(omnibar_count),
                              OMNIBAR,
                              omnibar_count
                              ];
        omnibar_count += 1;
      } else {
        compositeResult[i] = [historyResult.getValueAt(history_count),
                              historyResult.getCommentAt(history_count),
                              historyResult.getStyleAt(history_count),
                              historyResult.getImageAt(history_count),
                              HISTORY,
                              history_count
                              ];
        history_count += 1;
      }
    }
    this.compositeResult = compositeResult;
    if((max > 0) && (compositeResult[0][4] == OMNIBAR)) {
      // XXX Firefox mangles a suggestion when it cannot find a scheme in user
      // input. For ominbar suggestion to auto-complete, do we need to create
      // our own scheme like moz-action? Till then disable autocomplete for
      // search result with multiple words.
      this.defaultIndex = -1;
    }
    }catch(e){log(e)}
  },
  get matchCount() {
    return this._matchCount;
  },
  getValueAt: function(index) {
    return this.compositeResult[index][0];
  },
  getCommentAt: function(index) {
    return this.compositeResult[index][1];
  },
  getStyleAt: function(index) {
    return this.compositeResult[index][2];
  },
  getImageAt: function (index) {
    return this.compositeResult[index][3];
  },
  getLabelAt: function(index) {
    return this.getValueAt(index);
  },
  removeValueAt: function(index, removeFromDb) {
    //log('remove:'+index+'-'+removeFromDb);
    var res = this.compositeResult[index];
    if(res[4] == HISTORY) {
      this.historyResult.removeValueAt(res[5], removeFromDb);
      this.compositeResult.splice(index, 1);
    }
  },
  QueryInterface: function(aIID) {
    if (!aIID.equals(Ci.nsIAutoCompleteResult) && !aIID.equals(Ci.nsISupports))
        throw Components.results.NS_ERROR_NO_INTERFACE;
    return this;
  }
};



// list of *all* available tlds. update whenever a new tld pops-up.
// http://jecas.cz/tld-list/
const TLDS = [
  "AC",
  "ACADEMY",
  "ACCOUNTANTS",
  "ACTOR",
  "AD",
  "AE",
  "AERO",
  "AF",
  "AG",
  "AGENCY",
  "AI",
  "AIRFORCE",
  "AL",
  "AM",
  "AN",
  "AO",
  "AQ",
  "AR",
  "ARCHI",
  "ARMY",
  "ARPA",
  "AS",
  "ASIA",
  "ASSOCIATES",
  "AT",
  "ATTORNEY",
  "AU",
  "AUDIO",
  "AUTOS",
  "AW",
  "AX",
  "AXA",
  "AZ",
  "BA",
  "BAR",
  "BARGAINS",
  "BAYERN",
  "BB",
  "BD",
  "BE",
  "BEER",
  "BERLIN",
  "BEST",
  "BF",
  "BG",
  "BH",
  "BI",
  "BID",
  "BIKE",
  "BIO",
  "BIZ",
  "BJ",
  "BLACK",
  "BLACKFRIDAY",
  "BLUE",
  "BM",
  "BN",
  "BO",
  "BOUTIQUE",
  "BR",
  "BS",
  "BT",
  "BUILD",
  "BUILDERS",
  "BUZZ",
  "BV",
  "BW",
  "BY",
  "BZ",
  "BZH",
  "CA",
  "CAB",
  "CAMERA",
  "CAMP",
  "CAPITAL",
  "CARDS",
  "CARE",
  "CAREER",
  "CAREERS",
  "CASH",
  "CAT",
  "CATERING",
  "CC",
  "CD",
  "CENTER",
  "CEO",
  "CF",
  "CG",
  "CH",
  "CHEAP",
  "CHRISTMAS",
  "CHURCH",
  "CI",
  "CITIC",
  "CK",
  "CL",
  "CLAIMS",
  "CLEANING",
  "CLINIC",
  "CLOTHING",
  "CLUB",
  "CM",
  "CN",
  "CO",
  "CODES",
  "COFFEE",
  "COLLEGE",
  "COLOGNE",
  "COM",
  "COMMUNITY",
  "COMPANY",
  "COMPUTER",
  "CONDOS",
  "CONSTRUCTION",
  "CONSULTING",
  "CONTRACTORS",
  "COOKING",
  "COOL",
  "COOP",
  "COUNTRY",
  "CR",
  "CREDIT",
  "CREDITCARD",
  "CRUISES",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DANCE",
  "DATING",
  "DE",
  "DEGREE",
  "DEMOCRAT",
  "DENTAL",
  "DENTIST",
  "DESI",
  "DIAMONDS",
  "DIGITAL",
  "DIRECTORY",
  "DISCOUNT",
  "DJ",
  "DK",
  "DM",
  "DNP",
  "DO",
  "DOMAINS",
  "DZ",
  "EC",
  "EDU",
  "EDUCATION",
  "EE",
  "EG",
  "EMAIL",
  "ENGINEER",
  "ENGINEERING",
  "ENTERPRISES",
  "EQUIPMENT",
  "ER",
  "ES",
  "ESTATE",
  "ET",
  "EU",
  "EUS",
  "EVENTS",
  "EXCHANGE",
  "EXPERT",
  "EXPOSED",
  "FAIL",
  "FARM",
  "FEEDBACK",
  "FI",
  "FINANCE",
  "FINANCIAL",
  "FISH",
  "FISHING",
  "FITNESS",
  "FJ",
  "FK",
  "FLIGHTS",
  "FLORIST",
  "FM",
  "FO",
  "FOO",
  "FOUNDATION",
  "FR",
  "FROGANS",
  "FUND",
  "FURNITURE",
  "FUTBOL",
  "GA",
  "GAL",
  "GALLERY",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GIFT",
  "GIVES",
  "GL",
  "GLASS",
  "GLOBAL",
  "GLOBO",
  "GM",
  "GMO",
  "GN",
  "GOP",
  "GOV",
  "GP",
  "GQ",
  "GR",
  "GRAPHICS",
  "GRATIS",
  "GRIPE",
  "GS",
  "GT",
  "GU",
  "GUIDE",
  "GUITARS",
  "GURU",
  "GW",
  "GY",
  "HAMBURG",
  "HAUS",
  "HIPHOP",
  "HIV",
  "HK",
  "HM",
  "HN",
  "HOLDINGS",
  "HOLIDAY",
  "HOMES",
  "HORSE",
  "HOST",
  "HOUSE",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IMMOBILIEN",
  "IN",
  "INDUSTRIES",
  "INFO",
  "INK",
  "INSTITUTE",
  "INSURE",
  "INT",
  "INTERNATIONAL",
  "INVESTMENTS",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JETZT",
  "JM",
  "JO",
  "JOBS",
  "JP",
  "JUEGOS",
  "KAUFEN",
  "KE",
  "KG",
  "KH",
  "KI",
  "KIM",
  "KITCHEN",
  "KIWI",
  "KM",
  "KN",
  "KOELN",
  "KP",
  "KR",
  "KRED",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LAND",
  "LAWYER",
  "LB",
  "LC",
  "LEASE",
  "LI",
  "LIFE",
  "LIGHTING",
  "LIMITED",
  "LIMO",
  "LINK",
  "LK",
  "LOANS",
  "LONDON",
  "LR",
  "LS",
  "LT",
  "LU",
  "LUXE",
  "LUXURY",
  "LV",
  "LY",
  "MA",
  "MAISON",
  "MANAGEMENT",
  "MANGO",
  "MARKET",
  "MARKETING",
  "MC",
  "MD",
  "ME",
  "MEDIA",
  "MEET",
  "MENU",
  "MG",
  "MH",
  "MIAMI",
  "MIL",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MOBI",
  "MODA",
  "MOE",
  "MONASH",
  "MORTGAGE",
  "MOSCOW",
  "MOTORCYCLES",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MUSEUM",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NAGOYA",
  "NAME",
  "NAVY",
  "NC",
  "NE",
  "NET",
  "NEUSTAR",
  "NF",
  "NG",
  "NHK",
  "NI",
  "NINJA",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NYC",
  "NZ",
  "OKINAWA",
  "OM",
  "ONL",
  "ORG",
  "ORGANIC",
  "PA",
  "PARIS",
  "PARTNERS",
  "PARTS",
  "PE",
  "PF",
  "PG",
  "PH",
  "PHOTO",
  "PHOTOGRAPHY",
  "PHOTOS",
  "PICS",
  "PICTURES",
  "PINK",
  "PK",
  "PL",
  "PLUMBING",
  "PM",
  "PN",
  "POST",
  "PR",
  "PRESS",
  "PRO",
  "PRODUCTIONS",
  "PROPERTIES",
  "PS",
  "PT",
  "PUB",
  "PW",
  "PY",
  "QA",
  "QPON",
  "QUEBEC",
  "RE",
  "RECIPES",
  "RED",
  "REHAB",
  "REISE",
  "REISEN",
  "REN",
  "RENTALS",
  "REPAIR",
  "REPORT",
  "REPUBLICAN",
  "REST",
  "REVIEWS",
  "RICH",
  "RIO",
  "RO",
  "ROCKS",
  "RODEO",
  "RS",
  "RU",
  "RUHR",
  "RW",
  "RYUKYU",
  "SA",
  "SAARLAND",
  "SB",
  "SC",
  "SCHULE",
  "SCOT",
  "SD",
  "SE",
  "SERVICES",
  "SEXY",
  "SG",
  "SH",
  "SHIKSHA",
  "SHOES",
  "SI",
  "SINGLES",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SOCIAL",
  "SOFTWARE",
  "SOHU",
  "SOLAR",
  "SOLUTIONS",
  "SOY",
  "SPACE",
  "SR",
  "ST",
  "SU",
  "SUPPLIES",
  "SUPPLY",
  "SUPPORT",
  "SURGERY",
  "SV",
  "SX",
  "SY",
  "SYSTEMS",
  "SZ",
  "TATTOO",
  "TAX",
  "TC",
  "TD",
  "TECHNOLOGY",
  "TEL",
  "TF",
  "TG",
  "TH",
  "TIENDA",
  "TIPS",
  "TIROL",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TODAY",
  "TOKYO",
  "TOOLS",
  "TOWN",
  "TOYS",
  "TP",
  "TR",
  "TRADE",
  "TRAINING",
  "TRAVEL",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UK",
  "UNIVERSITY",
  "UNO",
  "US",
  "UY",
  "UZ",
  "VA",
  "VACATIONS",
  "VC",
  "VE",
  "VEGAS",
  "VENTURES",
  "VERSICHERUNG",
  "VET",
  "VG",
  "VI",
  "VIAJES",
  "VILLAS",
  "VISION",
  "VN",
  "VODKA",
  "VOTE",
  "VOTING",
  "VOTO",
  "VOYAGE",
  "VU",
  "WANG",
  "WATCH",
  "WEBCAM",
  "WEBSITE",
  "WED",
  "WF",
  "WIEN",
  "WIKI",
  "WORKS",
  "WS",
  "WTC",
  "WTF",
  "XN--3BST00M",
  "XN--3DS443G",
  "XN--3E0B707E",
  "XN--45BRJ9C",
  "XN--4GBRIM",
  "XN--55QW42G",
  "XN--55QX5D",
  "XN--6FRZ82G",
  "XN--6QQ986B3XL",
  "XN--80ADXHKS",
  "XN--80AO21A",
  "XN--80ASEHDB",
  "XN--80ASWG",
  "XN--90A3AC",
  "XN--C1AVG",
  "XN--CG4BKI",
  "XN--CLCHC0EA0B2G2A9GCD",
  "XN--CZR694B",
  "XN--CZRU2D",
  "XN--D1ACJ3B",
  "XN--FIQ228C5HS",
  "XN--FIQ64B",
  "XN--FIQS8S",
  "XN--FIQZ9S",
  "XN--FPCRJ9C3D",
  "XN--FZC2C9E2C",
  "XN--GECRJ9C",
  "XN--H2BRJ9C",
  "XN--I1B6B1A6A2E",
  "XN--IO0A7I",
  "XN--J1AMH",
  "XN--J6W193G",
  "XN--KPRW13D",
  "XN--KPRY57D",
  "XN--KPUT3I",
  "XN--L1ACC",
  "XN--LGBBAT1AD8J",
  "XN--MGB9AWBF",
  "XN--MGBA3A4F16A",
  "XN--MGBAAM7A8H",
  "XN--MGBAB2BD",
  "XN--MGBAYH7GPA",
  "XN--MGBBH1A71E",
  "XN--MGBC0A9AZCG",
  "XN--MGBERP4A5D4AR",
  "XN--MGBX4CD0AB",
  "XN--NGBC5AZD",
  "XN--NQV7F",
  "XN--NQV7FS00EMA",
  "XN--O3CW4H",
  "XN--OGBPF8FL",
  "XN--P1AI",
  "XN--PGBS0DH",
  "XN--Q9JYB4C",
  "XN--RHQV96G",
  "XN--S9BRJ9C",
  "XN--SES554G",
  "XN--UNUP4Y",
  "XN--WGBH1C",
  "XN--WGBL6A",
  "XN--XKC2AL3HYE2A",
  "XN--XKC2DL3A5EE0H",
  "XN--YFRO4I67O",
  "XN--YGBI2AMMX",
  "XN--ZFR164B",
  "XXX",
  "XYZ",
  "YACHTS",
  "YE",
  "YOKOHAMA",
  "YT",
  "ZA",
  "ZM",
  "ZONE",
  "ZW"
];

const ALT_DOT = String.fromCharCode(12290);

var SearchUtils = function() {
  this.wrappedJSObject = this;
  this.init();
}

SearchUtils.prototype = {
  classDescription: "Omnibar search query parser",
  classID:          Components.ID("{0cca1b29-1489-4826-ba0c-21fee771afbd}"),
  contractID:       "@ajitk.com/omnibar/queryparser;1",
  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsISupports]),
  RE_PROTOCOL_PREFIX: /^(www\.|http:|https:|ftp:|file:|chrome:)/i,
  RE_IP: /^(\d{1,3}\.){3}(\d{1,3}){1}(:\d+)*$/,
  RE_HOST: /^localhost(:\d+)*$/,
  RE_LIKE_IPV6_ADDR: /^\[\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*\](:\d+)*$/,
  RE_MOZ_ACTION: /^moz-action:([^,]+),(.*)$/,
  RE_NUM: /^\d*$/,
  init: function() {
    var ss = this._ss = Cc['@mozilla.org/browser/search-service;1']
                .getService(Ci.nsIBrowserSearchService);
    var engines = this._engines = [];
    ss.getEngines({}, []).forEach(function(e) {
      if(e.hidden !== true) {
        engines.push(e);
      }
    });
    this._prefBranch = Cc["@mozilla.org/preferences-service;1"]
                        .getService(Ci.nsIPrefService)
                        .getBranch("extensions.omnibar.");
    this._mainPref = Cc["@mozilla.org/preferences-service;1"]
                        .getService(Ci.nsIPrefBranch);
    this._bookmarks = Cc["@mozilla.org/browser/nav-bookmarks-service;1"].
                      getService(Ci.nsINavBookmarksService);
    this._faviconService = Cc["@mozilla.org/browser/favicon-service;1"]
                         .getService(Ci.nsIFaviconService);
  },
  getAllEngines: function() {
    return this._engines;
  },
  getIconSpec: function(uri){
    try {
      if(typeof uri === "string") {
        // TODO create a URL object.
        return "";
      }
      var iconURI = this._faviconService.getFaviconForPage(uri);
      return iconURI ? iconURI.spec : "";
    } catch (e){}
    return "";
  },
  getKeywordInfo: function(keyword) {
    // currently in FF, keywords cannot be a capital letter. when
    // getURIForKeyword is called for a keyword in uppercase, it hangs FF. fix
    // for now is to convert the keyword to lower case.
    keyword = keyword.toLowerCase();
    try {
      var bms = this._bookmarks;
      // getting some errors a this line
      var kwdURI = bms.getURIForKeyword(keyword);
      if (kwdURI) {
        var title = "keyword " + keyword;
        var items = bms.getBookmarkIdsForURI(kwdURI, {});
        for(var i = 0; items.length; i++) {
          if(bms.getKeywordForBookmark(items[i]) == keyword) {
            title = bms.getItemTitle(items[i]);
            break;
          }
        }
        return {
          keyword: keyword,
          spec: kwdURI.spec,
          title: title,
        };
      }
    } catch(e){}
    return undefined;
  },
  parseQuery: function(query) {
    // there a few things that we need to keep in mind here.
    // we need to respect user's way of searching things and should help him
    // search efficiently. a typical search process would consist of two things:
    // 1. the search query
    // 2. intended search engine(s). this is a tricky one to identify. our goal
    //    is to identify the search engines using @ operatoror or usage of
    //    search engine keywords as identifier of search engine. So, this is
    //    what we are going to do to parse user queries: first look for
    //    operator "@" at the begining of the search string.
    
    //    Case 1. if found "@" look for a syntax "@engine1,engine2, engine3
    //    search query" notice the empty space behind engine3 keyword. keep
    //    looking for comma-separated search eingine and stop as soon an entry
    //    is found that does not stand for a search engine.
    
    //    Case 2. user has entered a normal string (not starting with "@"). Now
    //    there can be a possibility that the user is trying to use a search
    //    engine keyword. In this case, find the keyword string (test words
    //    separated by space if it is a keyword) and perform search accordingly.
    
    //    in both cases it is important to show the intended result of user's
    //    query. user can choose to learn and refine his query so one can search
    //    easily and more intuitively.
    
    //    Case 3. "@engine name one, engine name two search query" How to handle
    //    this case where the engine name contains spaces and they may not be
    //    separated from teh search query with comma? TODO find a good solution
    var search_str = "";
    var engines = [];
    var isKeyword = false;
    var hasOperator = true;
    var pref = this._prefBranch;
    var OP = pref.getCharPref('operator');
    var SEP = pref.getCharPref('engineseparator');
    var user_format = OP + "$E$ $Q$";
    
    query = trim(query);
    
    // check if the query starts with a standard protocol.
    if(query.length == 0 || this.isAProtocolOrLocation(query)) {
      return [];
    }

    // no protocol is being used. proceed ahead with parsing the query.
    // before going ahead, there's one more kind of url that we need to handle.
    // what if the user is typing in some intranet url such as http://home/
    // etc? The best way to test that will be to actually try that and find out
    // if that kind of url is active and can be used or not.
    var enabledefaultsearch = pref.getBoolPref("enabledefaultsearch");
    var idxOfAt = query.indexOf(OP);
    if( idxOfAt === 0) {
      var keys = [];
      // what we are trying to parse: @ engine1 , engine2 ,engine3 search string
      search_str = trim(query.substring(1));
      // search_str = engine1 , engine2 ,engine3 search string
      var sequence = search_str.split(SEP);
      // sequence = ["engine1 ", " engine2 ", "engine3 search string"]
      var last_str = trim(sequence.pop());
      // sequence = ["engine1 ", " engine2 "]
      var end_sequence = last_str.split(" ");
      // end_sequence = ["engine3", "search", "string"]
      sequence.push(end_sequence.shift());
      // sequence = ["engine1 ", " engine2 ", "engine3"]
      // end_sequence = ["search", "string"]
      while(sequence.length >= 0) {
        var next_name = sequence[0];
        var finds = this.findEngines([next_name]);
        //log("!next engine name:|" + next_name + "| has N: " + finds.length);
        if(finds.length > 0) {
          keys.push(next_name);
          engines = engines.concat(finds);
          sequence.shift();
        } else if(next_name && next_name.length == 0) {
          // search engine names were separated by more than one whitespaces
          sequence.shift();
        } else {
          // found an entry which is not a valid search engine. time to stop;
          break;
        }
      }
      search_str = trim(sequence.join(SEP) + " " + end_sequence.join(" "));
      user_format = [OP, keys.join(SEP), " $Q$"].join("");
    } else if(idxOfAt > 0) {
      // once we know that there is an "@" character, reset the query to assume
      // it to be at the end. there maybe a "@"(OP) character in search string
      idxOfAt = query.lastIndexOf(OP);
      user_format = "$Q$ "+OP+"$E$";
      search_str = query.substring(0, idxOfAt);
      var engines_str = query.substring(idxOfAt + 1);
      engines = this.findEngines(engines_str.split(SEP));
    } else {
      // it is also possible to perform search in the form of: g y x search
      // query as one of the users suggested! this method can be refactored to
      // reuse the engine parsing logic if there is a need to!
      hasOperator = false;
      // look for any search engine keyword
      var seq = query.split(" ");
      var key = seq.shift();
      var engine = this.findByKeyword(key);
      if(engine) {  // user is going to use engine by keyword
        isKeyword = true;
        user_format = [key, "$Q$"].join(" ");
        engines.push(engine);
        search_str = seq.join(" ");
      } else if(enabledefaultsearch) {
        search_str = query;
      }
    }
    if(engines.length === 0) {
      hasOperator = false;
      // if none of the engines were found to match, search using default engine
      if(enabledefaultsearch) {
        engines.push(this._ss.currentEngine);
      }
    }
    if(enabledefaultsearch && engines.length == 1 && engines[0] == this._ss.currentEngine) {
      user_format = "$Q$";
    }
    //log([search_str, engines, user_format, isKeyword, hasOperator])
    return [search_str, engines, user_format, isKeyword, hasOperator];
  },
  isAProtocolOrLocation: function(query) {
    // first check if the query starts with a standard protocol.
    if(this.RE_PROTOCOL_PREFIX.test(query) || this.RE_IP.test(query) ||
       this.RE_HOST.test(query) || this.RE_LIKE_IPV6_ADDR.test(query) ||
       query.match(this.RE_MOZ_ACTION)) {
      return true;
    }
    if(query.indexOf(" ") < 0) {
      if(query.indexOf("/") > 0) {
        return true;
      }
      if(this.getKeywordInfo(query) != null) {
        return true;
      }
      
      var lastIndexOfDot = query.lastIndexOf(".");
      if(lastIndexOfDot < 0)
          lastIndexOfDot = query.lastIndexOf(ALT_DOT);
      if(lastIndexOfDot > 0) {
        // check for a possible TLD
        var tld_name = query.substring(lastIndexOfDot + 1).toUpperCase();
        var lastIndexOfColon = tld_name.lastIndexOf(':');
        if(lastIndexOfColon > 0) {
            var port_numer = tld_name.substring(lastIndexOfColon + 1);
            tld_name = tld_name.substring(0, lastIndexOfColon);
            if(this.RE_NUM.test(port_number) && TLDS.indexOf(tld_name) >= 0 ) {
                return true;
            }
        } else if(TLDS.indexOf(tld_name) >= 0) { // found a valid TLD!
          return true;
        }
      }
    }
    
    // perform a generic test if a protocol is being used.
    var protocol_name = query.substring(0, query.indexOf(":"));
    if(protocol_name.length > 0) { //a probable candidate!
      try {
        if(protocol_name.indexOf(" ") < 0
           && Cc["@mozilla.org/network/protocol;1?name="+protocol_name]
           ) {
          return true;
        }
      } catch (e) {}
    }
    
    // final test for a possible file path
    try {
      var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
      file.initWithPath(query);
      // came here w/o any exception => a valid file path
      return file.exists() || (query.indexOf(" ") < 0);
    } catch(e){
    }
    return false;
  },
  /**
   *
   */
  findByKeyword: function(kwd) {
    return this._ss.getEngineByAlias(kwd);
  },
  /**
   *
   */
  findEngines: function (nameHints) {
    var filteredEngines = [];
    var allEngines = this._engines;
    var self = this;
    nameHints.forEach(function(hint) {
      hint = trim(hint).toLowerCase();
      if(hint.length > 0) {
        var engine = self.findByKeyword(hint);
        if(engine) {
          filteredEngines.push(engine);
        } else {
          allEngines.forEach(function(e){
            var name = e.name.toLowerCase();
            if(name.indexOf(hint) == 0 && filteredEngines.indexOf(e) < 0) {
              filteredEngines.push(e);
            }
          });
        }
      }
    });
    return filteredEngines;
  }
}

function trim(str) {
  return str ? str.trim() : '';
}

function setHostNames() {
  var hostnames = PREF_BRANCH.getCharPref('hostnames').split(',');
  var buf = [];
  hostnames.forEach(function(name) {
    if(name.trim()) {
      buf.push('(^' +
        name.replace(/\./g, "\\.").replace(/\*/g, '.*') + 
        '(:\\d+)*$)');
    }
  });
  SearchUtils.prototype.RE_HOST = new RegExp(buf.join('|'), 'ig');
}

PREF_BRANCH.addObserver("", {
  observe: function() {
      setHistoryCount();
      setHostNames();
  }
}, false);
setHistoryCount();
setHostNames();

var components = [OmnibarSearch, DetailedOmnibarSearch, OmnibarAllInOne, SearchUtils];

/**
* XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4).
* XPCOMUtils.generateNSGetModule is for Mozilla 1.9.2 (Firefox 3.6).
*/
if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule(components);
