#!/usr/bin/env node

/**
 * MortyckHomeAssistent Tuya Local Key Extraction Tool
 * Guides users through fetching devId and localKey from the Tuya Developer Platform
 * and can automatically link them to discovered LAN devices (192.168.1.10 & 192.168.1.11).
 */

const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

const REGION_URLS = {
  eu: 'https://openapi.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com'
};

async function main() {
  console.log('\n=============================================================');
  console.log('   MortyckHomeAssistent — Tuya Local Key Extraction Wizard   ');
  console.log('=============================================================\n');
  console.log('Detected physical Tuya LAN devices on your network:');
  console.log('  1. IP: 192.168.1.10  (MAC: 7C:F6:66:7E:57:AD - Espressif)');
  console.log('  2. IP: 192.168.1.11  (MAC: 50:8A:06:DD:E3:8F - Espressif)\n');
  console.log('Choose your extraction method:');
  console.log('  [1] Interactive @tuyapi/cli Wizard (Recommended)');
  console.log('  [2] Direct Tuya Cloud OpenAPI Query (Fastest with API Credentials)');
  console.log('  [3] Manually enter devId & localKey for 192.168.1.10 / 192.168.1.11');
  console.log('  [4] View Step-by-Step Guide for iot.tuya.com registration\n');

  const choice = (await ask('Select an option [1-4] (default: 1): ')).trim() || '1';

  if (choice === '4') {
    printGuide();
    await ask('\nPress ENTER to return to menu...');
    return main();
  }

  if (choice === '1') {
    console.log('\nLaunching official @tuyapi/cli wizard via npx...');
    console.log('Make sure you have your Tuya Cloud Project API Key, Secret, and a Virtual ID from your Smart Life / Tuya app.\n');
    rl.close();

    const child = spawn('npx', ['@tuyapi/cli', 'wizard'], { stdio: 'inherit', shell: true });
    child.on('close', (code) => {
      console.log(`\nWizard finished with code ${code}.`);
      console.log('Copy the "id" (devId) and "key" (localKey) into OmniHub UI or devices.json!');
    });
    return;
  }

  if (choice === '2') {
    await runDirectCloudApi();
  } else if (choice === '3') {
    await runManualEntry();
  }

  rl.close();
}

function printGuide() {
  console.log('\n================ STEP-BY-STEP TUYA CLOUD SETUP ================');
  console.log('1. Go to https://iot.tuya.com/ and create a free account.');
  console.log('2. Navigate to "Cloud" -> "Development" -> "Create Cloud Project".');
  console.log('   - Project Plan: Trial Edition (Free)');
  console.log('   - Industry: Smart Home');
  console.log('   - Data Center: Central Europe (or your closest region)');
  console.log('3. In your project, go to the "Device Management" tab -> "Link Tuya App Account".');
  console.log('4. Open your Smart Life, Tuya, or Calex app on your phone.');
  console.log('   - Tap "Me" -> scan the QR code displayed on the screen.');
  console.log('   - Confirm authorization. All your devices are now linked!');
  console.log('5. Under the "Project Overview" tab, copy:');
  console.log('   - Access ID / Client ID  (Your API Key)');
  console.log('   - Access Secret          (Your API Secret)');
  console.log('===============================================================\n');
}

async function runDirectCloudApi() {
  console.log('\n--- Direct Tuya Cloud OpenAPI Query ---');
  printGuide();

  const clientId = (await ask('Enter Tuya Access ID / Client ID: ')).trim();
  const clientSecret = (await ask('Enter Tuya Access Secret: ')).trim();
  const region = (await ask('Enter Region [eu / us / cn / in] (default: eu): ')).trim().toLowerCase() || 'eu';
  const anyDeviceId = (await ask('Enter Device ID of ANY device in your app (found in App -> Device -> Device Info): ')).trim();

  if (!clientId || !clientSecret || !anyDeviceId) {
    console.log('Error: Client ID, Secret, and Device ID are required.');
    return;
  }

  const baseUrl = REGION_URLS[region] || REGION_URLS.eu;
  console.log(`\nConnecting to Tuya Cloud at ${baseUrl}...`);

  try {
    // 1. Get Token
    const t = Date.now().toString();
    const nonce = '';
    const stringToSign = `GET\n${crypto.createHash('sha256').update('').digest('hex')}\n\n/v1.0/token?grant_type=1`;
    const signStr = clientId + t + nonce + stringToSign;
    const sign = crypto.createHmac('sha256', clientSecret).update(signStr).digest('hex').toUpperCase();

    const tokenRes = await fetch(`${baseUrl}/v1.0/token?grant_type=1`, {
      headers: {
        'client_id': clientId,
        'sign': sign,
        't': t,
        'sign_method': 'HMAC-SHA256'
      }
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.success) {
      console.error('Failed to authenticate with Tuya Cloud:', tokenData.msg);
      return;
    }

    const accessToken = tokenData.result.access_token;
    console.log('Authentication successful! Access token acquired.');

    // 2. Query device information to get user uid
    const t2 = Date.now().toString();
    const strToSign2 = `GET\n${crypto.createHash('sha256').update('').digest('hex')}\n\n/v1.0/devices/${anyDeviceId}`;
    const signStr2 = clientId + accessToken + t2 + nonce + strToSign2;
    const sign2 = crypto.createHmac('sha256', clientSecret).update(signStr2).digest('hex').toUpperCase();

    const devRes = await fetch(`${baseUrl}/v1.0/devices/${anyDeviceId}`, {
      headers: {
        'client_id': clientId,
        'access_token': accessToken,
        'sign': sign2,
        't': t2,
        'sign_method': 'HMAC-SHA256'
      }
    });

    const devData = await devRes.json();
    if (!devData.success) {
      console.error('Failed to get device:', devData.msg);
      return;
    }

    const uid = devData.result.uid;
    console.log(`Found User ID: ${uid}. Fetching all linked user devices...`);

    // 3. Query all user devices
    const t3 = Date.now().toString();
    const strToSign3 = `GET\n${crypto.createHash('sha256').update('').digest('hex')}\n\n/v1.0/users/${uid}/devices`;
    const signStr3 = clientId + accessToken + t3 + nonce + strToSign3;
    const sign3 = crypto.createHmac('sha256', clientSecret).update(signStr3).digest('hex').toUpperCase();

    const allRes = await fetch(`${baseUrl}/v1.0/users/${uid}/devices`, {
      headers: {
        'client_id': clientId,
        'access_token': accessToken,
        'sign': sign3,
        't': t3,
        'sign_method': 'HMAC-SHA256'
      }
    });

    const allData = await allRes.json();
    if (!allData.success || !allData.result) {
      console.log('Device query returned:', allData);
      return;
    }

    console.log('\n================ FOUND TUYA DEVICES ================');
    const deviceList = allData.result;
    deviceList.forEach((d, idx) => {
      console.log(`[${idx + 1}] ${d.name}`);
      console.log(`    Device ID (devId) : ${d.id}`);
      console.log(`    Local Key         : ${d.local_key}`);
      console.log(`    Product Category  : ${d.category}`);
      console.log(`    LAN IP            : ${d.ip || 'Unknown / DHCP'}`);
      console.log('----------------------------------------------------');
    });

    const autoApply = (await ask('\nDo you want to automatically apply these keys to OmniHub devices? (y/n): ')).trim().toLowerCase();
    if (autoApply === 'y') {
      applyKeysToDevicesJson(deviceList);
    }
  } catch (err) {
    console.error('API Query error:', err.message);
  }
}

async function runManualEntry() {
  console.log('\n--- Manual Entry for Discovered LAN Devices ---');
  console.log('1. Device on 192.168.1.10 (MAC: 7C:F6:66:7E:57:AD)');
  const devId10 = (await ask('   Enter devId for 192.168.1.10: ')).trim();
  const key10 = (await ask('   Enter localKey (16 chars) for 192.168.1.10: ')).trim();

  console.log('\n2. Device on 192.168.1.11 (MAC: 50:8A:06:DD:E3:8F)');
  const devId11 = (await ask('   Enter devId for 192.168.1.11: ')).trim();
  const key11 = (await ask('   Enter localKey (16 chars) for 192.168.1.11: ')).trim();

  const devicesPath = path.join(__dirname, '..', 'backend', 'data', 'devices.json');
  if (fs.existsSync(devicesPath)) {
    const raw = fs.readFileSync(devicesPath, 'utf8');
    const list = JSON.parse(raw);

    list.forEach((d) => {
      if (d.ip === '192.168.1.10' && devId10 && key10) {
        d.tuya = { devId: devId10, localKey: key10, version: '3.3' };
        console.log('Updated 192.168.1.10 credentials in devices.json!');
      }
      if (d.ip === '192.168.1.11' && devId11 && key11) {
        d.tuya = { devId: devId11, localKey: key11, version: '3.3' };
        console.log('Updated 192.168.1.11 credentials in devices.json!');
      }
    });

    fs.writeFileSync(devicesPath, JSON.stringify(list, null, 2), 'utf8');
    console.log('Saved to backend/data/devices.json. Restart backend or trigger command to test!');
  }
}

function applyKeysToDevicesJson(deviceList) {
  const devicesPath = path.join(__dirname, '..', 'backend', 'data', 'devices.json');
  if (!fs.existsSync(devicesPath)) return;

  const raw = fs.readFileSync(devicesPath, 'utf8');
  const list = JSON.parse(raw);

  let updatedCount = 0;
  list.forEach((d) => {
    // Match by IP or match sequentially
    const match = deviceList.find((cloudDev) => cloudDev.ip === d.ip) || deviceList[updatedCount];
    if (match && match.local_key) {
      d.name = match.name || d.name;
      d.tuya = {
        devId: match.id,
        localKey: match.local_key,
        version: '3.3'
      };
      updatedCount++;
      console.log(`Assigned [${match.name}] credentials to ${d.ip}`);
    }
  });

  fs.writeFileSync(devicesPath, JSON.stringify(list, null, 2), 'utf8');
  console.log(`\nSuccessfully updated ${updatedCount} device(s) in backend/data/devices.json!`);
}

main();

