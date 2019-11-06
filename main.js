#!/usr/bin/env node

const yargs = require("yargs");
const FPN = require("./fpn.js");

const fpn = new FPN();

yargs
  .scriptName("fpn")
  .usage("$0 <cmd> [options]")

  .command("login [url] [deviceName]", "starts the authentication flow", {},
    argv => {
try { fpn.login(argv.url, argv.deviceName); } catch(e) { console.log(e); }})

  .command("logout", "forgets about your data", {},
    _ => fpn.logout())

  .command("show", "shows the current settings", {},
    _ => fpn.show())

  .command("account", "shows the current remote settings", {},
    _ => fpn.account())

  .command("servers", "shows the list of available servers", {},
    _ => fpn.servers(false))

  .command("fullservers", "shows the list of available servers (verbose)", {},
    _ => fpn.servers(true))

  .command("adddevice <deviceName>", "adds a device", {},
    argv => fpn.createDevice(argv.deviceName))

  .command("deldevice <deviceName>", "drops a device", {},
    argv => fpn.removeDevice(argv.deviceName))

  .command("activate [serverName] [interfaceName] [deviceName]", "activates the mozilla VPN", {},
    argv => fpn.activate(true, argv.deviceName, argv.interfaceName, argv.serverName))

  .command("deactivate [serverName] [interfaceName] [deviceName]", "activates the mozilla VPN", {},
    argv => fpn.activate(false, argv.deviceName, argv.interfaceName, argv.serverName))

  .demandCommand()
  .alias("h", "help")
  .alias("v", "version")
  .help()
  .argv
