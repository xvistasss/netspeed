---
title: "How NetSpeed's Testing Engine Works"
description: "A technical deep dive into how NetSpeed measures your network performance — from Cloudflare edge routing to Web Worker parallel streams and loaded latency measurement."
pubDate: 2026-07-08
author: "NetSpeed"
tags: ["technical", "netspeed", "speed-test", "engineering"]
---

Most speed tests are black boxes. You click a button, watch some numbers change, and get a result. NetSpeed takes a different approach: every part of the testing process is designed for accuracy, and the methodology is transparent. This article explains how the engine works under the hood, why each design choice matters, and what makes the results different from other tools you might have used.

## The server selection problem

The first challenge any speed test faces is choosing the right server. If the test server is far away, the results reflect the distance and routing quality between you and that server, not the actual capability of your connection.

NetSpeed solves this using Cloudflare's Anycast BGP routing. When you start a test, your request is automatically routed to the nearest Cloudflare edge data center based on real-time network topology. Cloudflare operates hundreds of data centers worldwide, so in most locations, the nearest edge is within a few hundred kilometers.

This approach has a key advantage over traditional speed tests that let you manually select a server. Manual selection introduces human error — choosing a server in the wrong city or country produces misleading results. Anycast routing removes this variable by always connecting you to the geometrically and topologically closest edge.

The engine also displays which edge data center it connected to and the estimated distance, giving you transparency into where your measurements are being taken.

## Non-compressible binary payloads

Traditional speed tests often download static files — images, videos, or pre-compressed archives. The problem with this approach is that ISPs and content delivery networks can cache these files. If your ISP has a local cache of the test file, the test measures the speed from the cache to your device, not from the internet to your device.

NetSpeed uses randomly generated binary payloads that cannot be compressed or cached. Each test generates unique data on the fly at the Cloudflare edge. This forces your ISP to handle raw, unoptimized data transit, giving you a more accurate picture of your actual connection capacity.

The payloads are served over HTTPS, which adds a small amount of encryption overhead. This is intentional — it reflects real-world conditions, since most internet traffic today is encrypted.

## Parallel Web Worker streams

A single download connection cannot fully saturate most modern internet connections. Network protocols like TCP have congestion control mechanisms that ramp up speed gradually, and a single stream often hits practical limits well below the connection's true capacity.

NetSpeed addresses this by using six parallel download streams, each running in its own Web Worker. Web Workers are background threads that run JavaScript outside the main page thread, allowing the test to manage multiple connections simultaneously without blocking the user interface or introducing UI jank.

The parallel streams are adaptive. The engine monitors the performance of each stream and adjusts the number of active connections based on what the network can handle. If the connection is fast, more streams are utilized. If the connection is slow, streams are reduced to avoid overwhelming the network.

This parallel approach is similar to how modern download managers work — by opening multiple connections to transfer different parts of a file simultaneously, you can achieve higher total throughput than a single connection would allow.

## Loaded latency measurement

This is where NetSpeed differs most from many other speed tests. Most tools measure latency by sending a handful of ping packets while the network is idle. This gives you the unloaded latency — how fast your connection responds when nothing else is using it.

But in real life, your network is rarely idle. Someone is streaming a video, a cloud backup is running, or a smart home device is syncing. Under these conditions, latency can spike dramatically due to bufferbloat — oversized buffers in your router or ISP equipment that queue packets instead of dropping them.

NetSpeed measures loaded latency during both the download and upload phases. While the parallel streams are actively transferring data, the engine sends ping packets and measures how much the latency increases under load. This loaded latency number is far more representative of your real-world experience than unloaded ping alone.

If your unloaded latency is 15 ms but your loaded latency jumps to 300 ms, you have significant bufferbloat, and your connection will feel sluggish whenever the network is busy — regardless of how fast your raw download speed is.

## Upload testing

The upload test works similarly to the download test but in reverse. The engine opens multiple parallel upload streams from your browser to the Cloudflare edge, pushing non-compressible binary data and measuring the throughput.

Upload testing is trickier than download testing because most browsers and operating systems prioritize download traffic over upload traffic. The engine accounts for this by calibrating the upload streams based on observed performance and adapting the test in real time.

## Jitter and packet loss

Beyond raw speed, the engine measures two additional metrics that significantly impact connection quality:

**Jitter** is measured by analyzing the variance in latency across multiple ping samples during the test. Consistent ping times indicate a stable connection; wide fluctuations indicate instability.

**Packet loss** is measured by tracking how many ping packets fail to reach the server and return. Even small amounts of packet loss — 1-2% — can noticeably degrade real-time applications like video calls and online games.

## The quality score

All of these metrics are combined into an overall quality score. The score weighs not just raw speed but also latency, jitter, packet loss, and loaded latency. A connection with fast speeds but terrible bufferbloat will score lower than a connection with moderate speeds and excellent stability.

The score is designed to reflect how the connection actually feels for typical use — a combination of responsiveness, stability, and throughput that determines whether your internet experience is smooth or frustrating.

## Transparency

NetSpeed displays all of its measurements in detail — not just the headline numbers. You can see the server location, the distance, the individual stream performance, the loaded vs unloaded latency comparison, and the raw measurement data. The goal is to give you the information you need to understand your connection, not just a single number that may or may not reflect reality.

You can try the engine yourself at [freenetspeed.com](/) and see the full breakdown of your connection's performance.
