var clc = require("cli-color");
const fetch = require("node-fetch");
const fs = require("fs");
const open = require("open");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const tmp = require("tmp");

const DEFAULT_URL = "https://fpn.firefox.com";
const DEFAULT_INTERFACE_NAME = "wg0";

module.exports = class FPN {
  validateURL(url) {
    try {
      return new URL(url || DEFAULT_URL);
    } catch (e) {
      process.write.stdout("The argument doesn't look like a valid URL.\n");
      process.exit(1);
    }
  }

  async fetch(url, options, statusCode = null) {
    try {
      const resp = await fetch(url, options);
      if (statusCode !== null && resp.status !== statusCode) {
        process.stdout.write(clc.red("something went wrong.\n"));
        process.exit(1);
      }

      return resp;
    } catch (e) {
      process.stdout.write(`Unable to reach \`${url}\`: ${e.message}\n`);
      process.exit(1);
    }
  }

  getReadline() {
    if (!this._rl) {
      this._rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      })
    }

    return this._rl;
  }

  configFile() {
    const homedir = os.homedir();
    return path.join(homedir, ".fpn.cf");
  }

  readConfigFile() {
    process.stdout.write("Retrieving credentials... ");
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.configFile(), "utf8"));
    } catch(e) {
      process.stdout.write(clc.red(`Unable to read the config file: \`${this.configFile()}\`.\n`));
      process.exit(1);
    }
    process.stdout.write(clc.green("done.\n"));
    return data;
  }

  removeConfigFile() {
    process.stdout.write("Removing credentials... ");
    fs.unlinkSync(this.configFile());
    process.stdout.write(clc.green("done.\n"));
  }

  async generateKeys() {
    process.stdout.write("Generating a private key... ");
    let privkey = await new Promise(resolve => {
      let key = "";
      let child = spawn("wg", ["genkey"]);
      child.stdout.on("data", data => key += data);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve(key.trim());
          return;
        }
        process.stdout.write(clc.red("something went wrong.\n"));
        process.exit(1);
      });
    });
    process.stdout.write(clc.green("done.\n"));

    process.stdout.write("Generating a public key... ");
    let pubkey = await new Promise(resolve => {
      let key = "";
      let child = spawn("wg", ["pubkey"]);
      child.stdin.write(privkey + "\n");
      child.stdin.end();
      child.stdout.on("data", data => key += data);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve(key.trim());
          return;
        }
        process.stdout.write(clc.red("something went wrong.\n"));
        process.exit(1);
      });
    });
    process.stdout.write(clc.green("done.\n"));

    return { privkey, pubkey };
  }

  async completeLogin(url) {
    process.stdout.write("Requesting a login token... ");
    url.pathname = "/api/v1/vpn/login";
    const resp = await this.fetch(url, { method: "POST" }, 200);

    const json = await resp.json();
    process.stdout.write(clc.green("done.\n"));

    await new Promise(resolve => {
      this.getReadline().question("Press [enter] to open the authentication page in the browser: ", resolve);
    });

    await open(json.login_url);

    process.stdout.write("Waiting... ");
    const data = await new Promise(resolve => {
      const wait = _ => {
        setTimeout(async _ => {
          const resp = await this.fetch(json.verification_url);
          if (resp.status === 200) {
            const json = await resp.json();
            resolve(json);
            return;
          }

          wait();
        }, json.poll_interval * 1000);
      }

      wait();
    });
    process.stdout.write(clc.green("done.\n"));

    return data;
  }

  async maybeRemoveDevice(data, deviceName) {
    const deviceId = data.user.devices.findIndex(device => device.name === deviceName);
    if (deviceId !== -1) {
      let response = await new Promise(resolve => {
        this.getReadline().question(`Device \`${deviceName}\` exists. Do you want to remove it? [y/N] `, resolve);
      });

      if (!response.startsWith("y") && !response.startsWith("Y")) {
        process.stdout.write("Abort by the user.\n");
        process.exit(0);
      }

      await this.removeDeviceInternal(data, deviceId);
    }
  }

  async createDeviceInternal(data, deviceName) {
    const keys = await this.generateKeys();

    process.stdout.write("Creating the device... ");

    const url = new URL(data.url);
    url.pathname = "/api/v1/vpn/device";
    const resp = await this.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: deviceName,
        pubkey: keys.pubkey,
      }),
    }, 201);

    const device = await resp.json();
    data.user.devices.push(device);

    data.keys.push({
      device: deviceName,
      ...keys
    });

    process.stdout.write(clc.green("done.\n"));
  }

  async storeCredentials(data) {
    process.stdout.write("Storing credentials... ");
    fs.writeFileSync(this.configFile(), JSON.stringify(data));
    process.stdout.write(clc.green("done.\n"));
  }

  async retrieveServers(data) {
    process.stdout.write("Retrieving servers list... ");
    const url = new URL(data.url);
    url.pathname = "/api/v1/vpn/servers";
    const resp = await this.fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${data.token}`,
        "Content-Type": "application/json",
      },
    }, 200);

    const json = await resp.json();
    process.stdout.write(clc.green("done.\n"));

    return json;
  }

  chooseServerPort(ranges) {
    let ports = [];
    ranges.forEach(range => {
      ports.push(range[0] + Math.floor(Math.random() * (range[1] - range[0])));
    });

    return ports[Math.floor(Math.random()*ports.length)];
  }

  async login(inputUrl, deviceName) {
    const url = new URL(this.validateURL(inputUrl));

    if (!deviceName) {
      deviceName = os.hostname();
      process.stdout.write(`No device name passed. Hostname is used instead: ${clc.cyan.bold(deviceName)}\n`);
    }

    const data = await this.completeLogin(url);
    data.url = url.origin;
    data.keys = [];

    await this.maybeRemoveDevice(data, deviceName);
    await this.createDeviceInternal(data, deviceName);

    data.servers = await this.retrieveServers(data);

    await this.storeCredentials(data);

    process.exit(0);
  }

  async logout() {
    const data = this.readConfigFile();

    for (let i = data.user.devices.length - 1; i >= 0; --i) {
      await this.removeDeviceInternal(data, i);
    }

    this.removeConfigFile();
  }

  async show() {
    const data = this.readConfigFile();

    this.showInternal(data.url, data.user, data.token);
  }

  showInternal(url, data, token = null) {
    process.stdout.write("\nGeneral:\n");
    process.stdout.write(` ${clc.yellow("*")} URL: ${clc.cyan.bold(url)}\n`);

    process.stdout.write("\nUser Data:\n");
    process.stdout.write(` ${clc.yellow("*")} Email: ${clc.cyan.bold(data.email)}\n`);
    process.stdout.write(` ${clc.yellow("*")} Avatar: ${clc.cyan.bold(data.avatar)}\n`);
    process.stdout.write(` ${clc.yellow("*")} Display Name: ${clc.cyan.bold(data.display_name)}\n`);

    if (token) {
      process.stdout.write(` ${clc.yellow("*")} Token: ${clc.cyan.bold(token)}\n`);
    }

    process.stdout.write("\nDevices:\n");
    data.devices.forEach(device => {
      process.stdout.write(` ${clc.yellow("*")} Name: ${clc.cyan.bold(device.name)}\n`);
      process.stdout.write(` ${clc.yellow("-")} Public Key: ${clc.cyan.bold(device.pubkey)}\n`);
      process.stdout.write(` ${clc.yellow("-")} IPv4 Address: ${clc.cyan.bold(device.ipv4_address)}\n`);
      process.stdout.write(` ${clc.yellow("-")} IPv6 Address: ${clc.cyan.bold(device.ipv6_address)}\n`);
      process.stdout.write(` ${clc.yellow("-")} Created At: ${clc.cyan.bold(device.created_at)}\n`);
    });

    process.stdout.write("\nSubscriptions:\n");
    for (let key in data.subscriptions) {
      const subscription = data.subscriptions[key];
      process.stdout.write(` ${clc.yellow("*")} Name: ${clc.cyan.bold(key)}\n`);
      process.stdout.write(` ${clc.yellow("-")} Active: ${clc.cyan.bold(subscription.active)}\n`);
      process.stdout.write(` ${clc.yellow("-")} Created At: ${clc.cyan.bold(subscription.created_at)}\n`);
      process.stdout.write(` ${clc.yellow("-")} Renews On: ${clc.cyan.bold(subscription.renews_on)}\n`);
    }
  }

  async createDevice(deviceName) {
    const data = this.readConfigFile();
    const deviceId = data.user.devices.findIndex(device => device.name === deviceName);
    if (deviceId !== -1) {
      process.stdout.write(`Device \`${clc.bold.cyan(deviceName)}\` already exists.\n`);
      process.exit(1);
    }

    await this.createDeviceInternal(data, deviceName);
    await this.storeCredentials(data);
  }

  async removeDevice(deviceName) {
    const data = this.readConfigFile();
    const deviceId = data.user.devices.findIndex(device => device.name === deviceName);
    if (deviceId === -1) {
      process.stdout.write(`Device \`${clc.bold.cyan(deviceName)}\` does not exist.\n`);
      process.exit(1);
    }

    if (data.user.devices.length === 1) {
      const response = await new Promise(resolve => {
       this.getReadline().question("Removing the last device, you logout. Do you want to proceed? [y/N] ", resolve);
      });

      if (!response.startsWith("y") && !response.startsWith("Y")) {
        process.stdout.write("Abort by the user.\n");
        process.exit(0);
      }
    }

    await this.removeDeviceInternal(data, deviceId);
    await this.storeCredentials(data);
  }

  async removeDeviceInternal(data, deviceId) {
    const device = data.user.devices[deviceId];
    process.stdout.write(`Removing the device ${device.name}... `);

    const url = new URL(data.url);
    url.pathname = `/api/v1/vpn/device/${encodeURIComponent(device.pubkey)}`;
    const resp = await this.fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${data.token}`,
      }
    }, 204);

    process.stdout.write(clc.green("done.\n"));
    data.user.devices.splice(deviceId, 1);
  }

  async account() {
    const data = this.readConfigFile();

    process.stdout.write("Retrieving account data... ");
    const url = new URL(data.url);
    url.pathname = "/api/v1/vpn/account";
    const resp = await this.fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${data.token}`,
        "Content-Type": "application/json",
      },
    }, 200);

    const remoteData = await resp.json();
    process.stdout.write(clc.green("done.\n"));

    this.showInternal(url.origin, remoteData);
  }

  async servers(verbose) {
    const data = this.readConfigFile();

    process.stdout.write("\nCountries:\n");
    data.servers.countries.forEach(country => {
      process.stdout.write(` ${clc.yellow("*")} ${clc.cyan.bold(country.name)}`);
      process.stdout.write(` - code: ${clc.cyan.bold(country.code)}\n`);
      process.stdout.write(" - cities:\n");
      country.cities.forEach(city => {
        process.stdout.write(`   > ${clc.cyan(city.name)}\n`);
        process.stdout.write(`     code: ${clc.cyan(city.code)}\n`);
        process.stdout.write(`     latitude: ${clc.cyan(city.latitude)}\n`);
        process.stdout.write(`     longitude: ${clc.cyan(city.longitude)}\n`);
        if (verbose) {
          process.stdout.write("     servers:\n");
          city.servers.forEach(server => {
            let first = true;
            for (let prop in server) {
              process.stdout.write(`      ${first ? "." : " "} ${prop}: `);
              if (Array.isArray(server[prop])) {
                process.stdout.write(server[prop].join(", "));
              } else {
                process.stdout.write(`${server[prop]}`);
              }
              process.stdout.write("\n");
              first = false;
            }
          });
        } else {
          process.stdout.write(`     servers: ${clc.cyan(city.servers.map(server => server.hostname).join(", "))}\n`);
        }
      });
    });
  }

  async activate(up, deviceName, interfaceName, serverName) {
    if (!deviceName) {
      deviceName = os.hostname();
      process.stdout.write(`No device name passed. Hostname is used instead: ${clc.cyan.bold(deviceName)}\n`);
    }

    if (!interfaceName) {
      interfaceName = DEFAULT_INTERFACE_NAME;
    }

    const data = this.readConfigFile();

    const device = data.user.devices.find(device => device.name === deviceName);
    if (!device) {
      process.stdout.write(`Device \`${clc.bold.cyan(deviceName)}\` does not exist.\n`);
      process.exit(1);
    }

    const keys = data.keys.find(device => device.device === deviceName);
    if (!keys) {
      process.stdout.write(`No private key for device \`${clc.bold.cyan(deviceName)}\`.\n`);
      process.exit(1);
    }

    const list = [];

    data.servers.countries.forEach(country => {
      country.cities.forEach(city => {
        city.servers.forEach(server => {
          list.push({
            country: country.name,
            city: city.name,
            ...server,
          });
        });
      });
    });

    let server;

    if (serverName) {
      server = list.find(s => s.hostname === serverName);
      if (!server) {
        process.stdout.write(`Server \`${clc.bold.cyan(serverName)}\` does not exist.\n`);
        process.exit(1);
      }
    } else {
      server = list[Math.floor(Math.random()*list.length)];
    }

    if (!server) {
      process.stdout.write("No server?!?\n");
      process.exit(1);
    }

    process.stdout.write("Server:\n");
    for (let prop in server) {
      let value = Array.isArray(server[prop]) ? server[prop].join(", ") : server[prop];
      process.stdout.write(` ${clc.yellow("*")} ${prop}: ${clc.cyan.bold(value)}\n`);
    }

    process.stdout.write("Creating the configuration file... ");

    const tmpobj = tmp.dirSync({ unsafeCleanup: true });
    const filepath = path.join(tmpobj.name, `${interfaceName}.conf`);

    await new Promise(resolve => {
      const stream = fs.createWriteStream(filepath, { encoding: "utf8" });
      stream.on("finish", _ => resolve());
      stream.write("[Interface]\n");
      stream.write(`PrivateKey = ${keys.privkey}\n`);
      stream.write(`Address = ${device.ipv4_address}, ${device.ipv6_address}\n`);
      stream.write(`DNS = ${server.ipv4_gateway}\n`);
      stream.write("\n[Peer]\n");
      stream.write(`PublicKey = ${server.public_key}\n`);
      stream.write(`Endpoint = ${server.ipv4_addr_in}:${this.chooseServerPort(server.port_ranges)}\n`);
      stream.write("AllowedIPs = 0.0.0.0/0,::0/0\n");
      stream.end();
    });

    process.stdout.write(`${clc.bold.cyan(filepath)}\n`);

    process.stdout.write("Executing wg-quick:\n");

    await new Promise(resolve => {
      let child = spawn("wg-quick", [up ? "up" : "down", filepath]);
      child.stdout.pipe(process.stdout, { end: false });
      child.stderr.pipe(process.stderr, { end: false });
      child.on("exit", (code, signal) => {
        if (code === 0) {
          process.stdout.write(clc.bold.green("VPN should be up and running.\n"));
        } else {
          process.stdout.write(clc.red("something went wrong.\n"));
        }

        resolve();
      });
    });

    tmpobj.removeCallback();
  }
}
