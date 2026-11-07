var app;
var chromeHandle;
function install() {}
function uninstall() {}
async function startup({rootURI}) {
  const manager = Components.classes['@mozilla.org/addons/addon-manager-startup;1'].getService(Components.interfaces.amIAddonManagerStartup);
  chromeHandle = manager.registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [['content', 'bilingual-metadata', 'src/']]);
  const scope = {Zotero, Services, ChromeUtils, IOUtils, PathUtils, DOMParser, XMLSerializer, rootURI};
  Services.scriptloader.loadSubScript(rootURI + 'src/styleAdapter.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'src/core.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'src/sources.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'src/englishItems.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'src/linkedCitations.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'src/preferences.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'src/plugin.js', scope);
  app = scope.BilingualPlugin;
  await app.start();
}
function onMainWindowLoad({window}) { app?.attach(window); }
function onMainWindowUnload({window}) { app?.detach(window); }
function shutdown() { app?.stop(); app = null; chromeHandle?.destruct(); chromeHandle = null; }
