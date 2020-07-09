#!/usr/bin/env node

const yargs = require("yargs");
const MozillaVPN = require("./vpn.js");

const mvpn = new MozillaVPN();

yargs
  .scriptName("mozillavpn")
  .usage("$0 <cmd> [options]")

  .command("login [url] [deviceName]", "starts the authentication flow", {},
    argv => mvpn.login(argv.url, argv.deviceName))

  .command("logout", "forgets about your data", {},
    () => mvpn.logout())

  .command("show", "shows the current settings", {},
    () => mvpn.show())

  .command("account", "shows the current remote settings", {},
    () => mvpn.account())

  .command("servers", "shows the list of available servers", {},
    () => mvpn.servers())

  .command("adddevice <deviceName>", "adds a device", {},
    argv => mvpn.createDevice(argv.deviceName))

  .command("deldevice <deviceName>", "drops a device", {},
    argv => mvpn.removeDevice(argv.deviceName))

  .command("activate [serverName] [interfaceName] [deviceName]", "activates the mozilla VPN", {},
    argv => mvpn.activate(true, argv.deviceName, argv.interfaceName, argv.serverName))

  .command("deactivate [serverName] [interfaceName] [deviceName]", "activates the mozilla VPN", {},
    argv => mvpn.activate(false, argv.deviceName, argv.interfaceName, argv.serverName))

  .demandCommand()
  .strict()
  .alias("h", "help")
  .alias("v", "version")
  .help()
  .argv
