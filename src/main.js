#!/usr/bin/env node

const yargs = require("yargs");
const MozillaVPN = require("./vpn.js");

const mozilla_vpn = new MozillaVPN();

yargs
  .scriptName("mozilla_vpn")
  .usage("$0 <cmd> [options]")

  .command("login [url] [deviceName]", "starts the authentication flow", {},
    argv => mozilla_vpn.login(argv.url, argv.deviceName))

  .command("logout", "forgets about your data", {},
    _ => mozilla_vpn.logout())

  .command("show", "shows the current settings", {},
    _ => mozilla_vpn.show())

  .command("account", "shows the current remote settings", {},
    _ => mozilla_vpn.account())

  .command("servers", "shows the list of available servers", {},
    _ => mozilla_vpn.servers(false))

  .command("fullservers", "shows the list of available servers (verbose)", {},
    _ => mozilla_vpn.servers(true))

  .command("adddevice <deviceName>", "adds a device", {},
    argv => mozilla_vpn.createDevice(argv.deviceName))

  .command("deldevice <deviceName>", "drops a device", {},
    argv => mozilla_vpn.removeDevice(argv.deviceName))

  .command("activate [serverName] [interfaceName] [deviceName]", "activates the mozilla VPN", {},
    argv => mozilla_vpn.activate(true, argv.deviceName, argv.interfaceName, argv.serverName))

  .command("deactivate [serverName] [interfaceName] [deviceName]", "activates the mozilla VPN", {},
    argv => mozilla_vpn.activate(false, argv.deviceName, argv.interfaceName, argv.serverName))

  .demandCommand()
  .strict()
  .alias("h", "help")
  .alias("v", "version")
  .help()
  .argv
