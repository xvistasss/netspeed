---
title: "How to Troubleshoot Slow Internet at Home"
description: "A step-by-step diagnostic guide to finding and fixing the cause of slow internet — from simple restarts to identifying whether the problem is your WiFi, equipment, or ISP."
pubDate: 2026-07-06
author: "NetSpeed"
tags: ["troubleshooting", "internet", "guide"]
---

Slow internet is frustrating because the cause can be anywhere — your device, your WiFi, your router, your modem, your ISP, or even something outside everyone's control. Rather than guessing, a systematic approach will help you narrow down the problem quickly and find the right fix.

## Step one: establish a baseline

Before you change anything, run a [speed test](/) on the device that feels slow. Write down the download speed, upload speed, latency, and jitter. Then test on a different device if you have one available. If both devices show similar results, the problem is likely with your network, not a single device. If only one device is slow, the problem is probably that specific device.

## Step two: the restart sequence

The classic "turn it off and on again" works more often than people expect. But the order matters. Follow this sequence:

1. **Restart the slow device.** Close all applications and restart the computer or phone.
2. **Restart your router.** Unplug it from power, wait 30 seconds, plug it back in, and wait for all lights to stabilize.
3. **Restart your modem.** If your modem is separate from your router, unplug it, wait 30 seconds, plug it back in, and wait for it to fully connect (usually 2-5 minutes).
4. **Restart everything in order:** modem first, then router, then device.

This clears stale connection states, releases and renews IP addresses, and resolves many temporary glitches.

## Step three: test with Ethernet

Connect your computer directly to the router (or modem, if you do not have a separate router) using an Ethernet cable. Disable WiFi on your computer to ensure the test uses the wired connection. Run a speed test.

If speeds on Ethernet are close to what your ISP promises, the problem is your WiFi. If speeds are still slow on Ethernet, the problem is either your equipment or your ISP connection.

## Step four: diagnose WiFi issues

If the Ethernet test was fine but WiFi is slow, investigate your wireless setup:

**Check signal strength.** Move closer to the router and test again. If speed improves significantly, you have a coverage problem. Consider repositioning the router to a central, elevated location or adding a WiFi extender.

**Check for interference.** The 2.4 GHz band is prone to interference from neighboring networks, Bluetooth devices, and household electronics. Try switching to the 5 GHz band if your devices support it. The 5 GHz band is faster and less congested, though it has shorter range.

**Check connected devices.** Too many devices on WiFi compete for airtime. Disconnect devices you are not actively using and test again.

**Check the WiFi standard.** If your router is older (802.11n or earlier), it may not support modern speeds. WiFi 5 (802.11ac) and WiFi 6 (802.11ax) offer significantly better performance.

## Step five: identify bandwidth hogs

Even with a fast connection, a single device or application consuming most of the bandwidth will slow everything else down. Common culprits include:

- Cloud backup services (iCloud, Google Drive, Dropbox) running in the background
- System or application updates downloading
- Streaming on other TVs or devices
- Other household members downloading large files or gaming

Ask everyone in the household to pause heavy usage temporarily, then run your test again. If speeds improve dramatically, the issue is bandwidth contention, not your ISP.

## Step six: check for bufferbloat

If your speeds are fine when the network is idle but everything feels slow when someone starts a large download, you likely have bufferbloat. This is a condition where oversized buffers in your router cause latency to spike under load, making the connection feel slow even though raw speed is fine.

Our [speed test](/) measures loaded latency during the download and upload phases. Compare your idle ping to your loaded ping. If the loaded ping is 200 ms or more higher than idle, bufferbloat is a problem. Enabling Smart Queue Management (SQM) on your router — if it supports it — is the most effective fix.

## Step seven: rule out device problems

Sometimes the problem is the device itself, not the network:

- **Check for malware.** Malware can consume bandwidth and system resources. Run a scan with your preferred security software.
- **Check for background processes.** Open your task manager or activity monitor to see if any application is using excessive network or CPU resources.
- **Clear browser cache.** A corrupted cache can cause pages to load slowly even with a fast connection.
- **Try a different browser.** If one browser is slow but another is fine, the issue is browser-specific.

## Step eight: check your ISP

If you have ruled out everything on your end, the problem may be with your ISP. This could be:

- Network congestion in your area during peak hours
- A problem with the line to your home
- An issue with your ISP's DNS servers
- Equipment at the ISP's end that needs maintenance

Contact your ISP with specific information: the tests you ran, the results on Ethernet versus WiFi, and the times when speeds were worst. The more data you provide, the more likely they are to take action.

## Prevention

Once you have resolved the immediate problem, take steps to prevent it from recurring:

- Restart your router and modem monthly to clear accumulated state.
- Keep your router firmware updated.
- Replace aging equipment every 3-5 years.
- Run periodic speed tests to track your connection quality over time.

Network problems are easier to diagnose when you have historical data showing when and how your connection has changed.
