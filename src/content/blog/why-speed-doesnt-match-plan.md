---
title: "Why Your Speed Test Doesn't Match Your ISP's Advertised Speed"
description: "Your speed test shows 80 Mbps but you pay for 300 Mbps? Here is why advertised speeds rarely match real-world results and what you can do about it."
pubDate: 2026-07-05
author: "NetSpeed"
tags: ["isp", "speed-test", "internet", "guide"]
---

You signed up for a 300 Mbps internet plan, but when you run a speed test, you get 80 Mbps. You call your ISP, and they tell you everything is working fine. Who is right? In most cases, both of you — because advertised speeds and real-world speeds are measured under very different conditions.

## How ISPs advertise speed

When an ISP advertises a speed, they use a specific phrase: "up to." That "up to" is doing a lot of heavy lifting. The number represents the maximum theoretical speed your connection can achieve under ideal conditions — conditions that rarely exist in your home.

ISPs measure these speeds at the network level, from their equipment to the edge of their network, without accounting for the last stretch of cable, your home wiring, your router, or your device. They also measure during off-peak hours when network traffic is minimal. The speed they advertise is not a guarantee; it is a ceiling.

## Protocol overhead

Every internet connection has overhead. TCP/IP headers, encryption layers, and routing information all consume a portion of your raw bandwidth. On a typical connection, this overhead accounts for 5-15% of your advertised speed. So on a 300 Mbps plan, you might see a maximum of around 270 Mbps even under perfect conditions.

This is normal and expected. It is not a sign that your ISP is shortchanging you — it is a fundamental characteristic of how internet protocols work.

## Your home network matters

The biggest factor most people overlook is their own home network. The speed from your ISP arrives at your modem, but from there it has to travel through your home wiring, your router, and possibly over WiFi before it reaches your device. Each step introduces potential bottlenecks.

**Your router** is often the weakest link. A cheap or outdated router might only support 100 Mbps on its Ethernet ports, even if your internet plan delivers 300 Mbps. Check whether your router's LAN ports are Gigabit (1000 Mbps) or Fast Ethernet (100 Mbps). If you have Fast Ethernet ports, you are capped at 100 Mbps no matter what your ISP delivers.

**WiFi adds significant overhead.** Even on a strong 5 GHz WiFi signal, you will typically get 50-70% of the theoretical maximum speed. Move farther from the router or add walls between you and it, and that percentage drops further. A 300 Mbps plan over WiFi might realistically deliver 150-200 Mbps in the same room and 80-100 Mbps two rooms away.

**Old cables matter.** If you are using a Cat5 cable (not Cat5e or Cat6) for your Ethernet connections, you are limited to 100 Mbps regardless of what your ISP delivers.

## Network congestion

Your internet connection shares bandwidth with your neighbors. ISPs oversell their capacity, meaning they sell more total bandwidth than their infrastructure can deliver simultaneously. This works because not everyone uses their full bandwidth at the same time. But during peak hours — typically 7 PM to 11 PM in residential areas — the shared network becomes congested, and speeds drop.

This is especially common with cable internet, where neighbors share the same coaxial cable. Fiber connections tend to be more resilient because the total available bandwidth is much higher, but even fiber can experience congestion at the ISP's core network.

## Server and test limitations

The speed test server you connect to plays a significant role in your results. If the server is far away, or if it is experiencing high load, your test results will be lower than your actual connection capacity. Your ISP's own speed test servers are often the most accurate because they are closest to their network, but they are also the most likely to be optimized for flattering results.

The time of day matters too. Running a test at 3 AM when network traffic is minimal will give you different results than running it at 8 PM when everyone in your neighborhood is streaming Netflix.

## What you can do

Before blaming your ISP, rule out problems on your end:

1. **Test with Ethernet.** Connect your computer directly to the modem with a Gigabit Ethernet cable and run a [speed test](/). This eliminates your WiFi and router from the equation. If you get close to your advertised speed on Ethernet but not on WiFi, the problem is your home network, not your ISP.

2. **Check your equipment.** Make sure your router supports Gigabit on all its Ethernet ports. If your modem is provided by your ISP, ask whether it supports your plan's speed tier. Older DOCSIS 3.0 modems may not handle speeds above 100-300 Mbps.

3. **Test at different times.** Run tests in the morning, afternoon, and evening on different days. If speeds are consistently lower during peak hours, network congestion is likely the cause.

4. **Restart your equipment.** Modems and routers can develop issues over time. A simple restart can sometimes resolve speed problems caused by memory leaks or stale connection states.

5. **Check for background usage.** Other devices on your network might be consuming bandwidth — cloud backups, system updates, streaming on other TVs or devices. Pause all background activity and test again.

## When to call your ISP

If you have ruled out local issues and your speeds are consistently well below what you pay for, contact your ISP. Provide them with test results from Ethernet connections at different times of day. Document the pattern. ISPs are more likely to take action when you present consistent data rather than a single complaint.

If your ISP cannot resolve the issue, it may be worth exploring alternative providers in your area or upgrading your equipment. A faster plan does not help if the bottleneck is somewhere in the infrastructure between your ISP and your home.
