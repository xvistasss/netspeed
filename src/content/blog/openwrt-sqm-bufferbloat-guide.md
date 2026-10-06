---
title: "Configuring OpenWrt SQM (CAKE & FQ-CoDel) to Eliminate Bufferbloat"
description: "A complete technical walkthrough on configuring Smart Queue Management (SQM) with CAKE and FQ-CoDel on OpenWrt routers to achieve an A+ bufferbloat score under full load."
pubDate: 2026-10-05
author: "Apurba"
tags: ["openwrt", "bufferbloat", "sqm", "cake", "networking", "router"]
---

Bufferbloat is the single biggest cause of unpredictable latency spikes, audio cutouts on Zoom calls, and gaming packet delays. When your household connection is saturated by a video backup or game patch download, dumb FIFO (First In, First Out) packet queues in consumer modems and routers balloon, delaying time-critical packets by hundreds of milliseconds.

While upgrading your internet bandwidth tier increases raw throughput, it does not solve queue congestion. The true engineering fix is **Smart Queue Management (SQM)**.

In this guide, we walk through configuring the **CAKE** (Common Applications Kept Enhanced) and **FQ-CoDel** (Fair Queuing Controlled Delay) queue disciplines on an OpenWrt router to maintain single-digit loaded latency under 100% upload and download saturation.

---

## Prerequisites and Package Installation

To follow this setup, you need an OpenWrt router (running OpenWrt 21.02, 22.03, 23.05, or newer) connected to your modem or ONT.

Connect to your router via SSH or open the LuCI web interface:

```bash
ssh root@192.168.1.1
```

Update your package feed and install the SQM subsystem packages:

```bash
opkg update
opkg install luci-app-sqm sqm-scripts kmod-sched-cake
```

Once installed, reload the LuCI web server or reboot the router to register the new interface tab under **Network → SQM QoS**.

---

## Step 1: Benchmark Your Baseline Connection

Before enabling SQM, you must know your **true unshaped line capacity**. SQM functions by acting as the artificial bottleneck on your link, forcing packet queuing to happen inside the router's active queue manager rather than in your ISP's unmanaged DSLAM, CMTS, or GPON buffer.

1. Disconnect all other devices from the network or run the test during a quiet period.
2. Connect your test machine directly via Gigabit Ethernet (avoid Wi-Fi testing for calibration).
3. Run our [NetSpeed diagnostic test](/) to capture:
   * **Unloaded (Idle) Latency**
   * **Download Saturation Throughput** (e.g., 280 Mbps)
   * **Upload Saturation Throughput** (e.g., 28 Mbps)
   * **Loaded Latency (Bufferbloat delta)**

Record these numbers. If your idle ping is 18 ms and your loaded ping jumps to 240 ms during upload, you have roughly 220 ms of unmanaged buffer delay.

---

## Step 2: Configure SQM Interface & Bandwidth Limits

In the OpenWrt web interface, navigate to **Network → SQM QoS** (or edit `/etc/config/sqm` directly via CLI).

### 1. Basic Settings Tab

* **Enable:** Check `Enable this SQM instance`.
* **Interface name:** Select your WAN interface (typically `wan` or `eth0.2` depending on your router board architecture). Do **not** select `br-lan`.
* **Download speed (kbit/s):** Set to **85% to 90%** of your baseline download speed.
* **Upload speed (kbit/s):** Set to **85% to 90%** of your baseline upload speed.

> **Why the 85-90% rule?**  
> SQM must be the slowest hop in the chain. If your ISP link throttles at 30 Mbps and you tell SQM to shape at 30 Mbps, small transmission spikes will spill into the ISP's buffer, triggering bufferbloat. By capping your router at 27 Mbps (90%), your router always stays in control of the queue.

For example, on a 300 Mbps download / 30 Mbps upload connection:
* Download limit: `270000` (kbit/s)
* Upload limit: `27000` (kbit/s)

---

## Step 3: Select Queue Discipline (CAKE vs FQ-CoDel)

Switch to the **Queue Discipline** tab:

### Choosing Queue Discipline
* **`cake` (Recommended):** The successor to FQ-CoDel, designed by Jonathan Morton and Dave Täht. CAKE combines fair queueing, CoDel active queue management, round-trip time auto-scaling, and per-host/per-flow fairness into a single unified packet scheduler.
* **`fq_codel`:** The classic Active Queue Management discipline. Use this if your router has an older, underpowered CPU (e.g. single-core MIPS under 600 MHz) that struggles to process CAKE at speeds above 100 Mbps.

### Choosing Queue Setup Script
* For CAKE: Select `piece_of_cake.qos`.
* For FQ-CoDel: Select `simplest.qos` or `simple.qos`.

---

## Step 4: Link Layer Framing and Overhead Compensation

Switch to the **Link Layer Adaptation** tab. This step is critical and often missed in generic guides.

Packets traversing your physical connection are encapsulated into physical frames (Ethernet, ATM cells, or DOCSIS frames). If your router calculates packet sizes based only on IP packet headers without factoring in physical layer framing overhead, your queue will burst past the line rate and bufferbloat will reoccur.

| Internet Connection Type | Framing Option | Overhead Value (Bytes) | Notes |
| :--- | :--- | :--- | :--- |
| **Fiber (GPON / Direct Ethernet / IPoE)** | Ethernet with VLAN | `44` | Handles VLAN tag + FCS + interframe gap |
| **VDSL2 / Vectoring (PTM)** | PTM / Ethernet | `30` | Common for modern DSL lines |
| **ADSL / ADSL2+ (ATM)** | ATM | `40` | Requires ATM cell quantization checkbox enabled |
| **Cable (DOCSIS 3.0 / 3.1)** | Ethernet with VLAN | `18` | Standard DOCSIS framing overhead |

If you are unsure of your exact framing, setting **Ethernet** with an overhead of `22` to `34` bytes provides a safe conservative margin.

---

## Configuration File Verification (`/etc/config/sqm`)

If configuring via command line, your `/etc/config/sqm` should look similar to this:

```ini
config queue 'eth1'
	option enabled '1'
	option interface 'wan'
	option download '270000'
	option upload '27000'
	option qdisc 'cake'
	option script 'piece_of_cake.qos'
	option linklayer 'ethernet'
	option overhead '44'
	list qdisc_opts 'nat'
	list qdisc_opts 'diffserv4'
```

Apply and restart the SQM service:

```bash
/etc/init.d/sqm restart
```

---

## Step 5: Testing and Real-Time Verification

Verify that SQM is actively scheduling packets by inspecting kernel queuing stats while running a stress test:

```bash
tc -s qdisc show dev $(uci get sqm.@queue[0].interface)
```

Look for the `cake` queuing stats output:
* `pkts` and `bytes` should increment rapidly during the test.
* `drops` should remain low (0.01% - 0.5%).
* `marks` (ECN marks) indicate TCP connections are being notified to scale back their congestion windows without dropping packets.

Now run the [NetSpeed speed test](/) again.

### Interpreting Your Results:
* **Idle Ping:** e.g. `16 ms`
* **Download Loaded Ping:** e.g. `18 ms` (Delta: `+2 ms`)
* **Upload Loaded Ping:** e.g. `19 ms` (Delta: `+3 ms`)
* **Bufferbloat Grade:** **A+**

If your loaded ping delta is higher than 15 ms, reduce your configured download and upload limits by an additional 3–5% until latency stays completely flat during heavy traffic.

With SQM properly configured, you can upload massive 4K video files, download large game updates, and stream simultaneously without a single drop in voice call quality or competitive gaming responsiveness.
