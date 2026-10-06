---
title: "Diagnosing Asymmetric Fiber Speeds: When Gigabit Upload Drastically Drops"
description: "A technical troubleshooting guide for fiber broadband subscribers experiencing full download speeds but severely degraded upload throughput. Covers ONT policers, TCP window scaling, and NIC offloading."
pubDate: 2026-09-30
author: "Apurba"
tags: ["fiber", "broadband", "gpon", "tcp", "networking", "troubleshooting"]
---

You subscribed to a symmetrical Gigabit fiber plan (1000 Mbps download / 1000 Mbps upload), but when you run a benchmark, your download speed hits 940 Mbps while your upload stalls at 35 Mbps, 80 Mbps, or fluctuates erratically.

Because fiber optic cables possess virtually unlimited physical bandwidth, many users assume optical degradation or bad fiber patch cords are at fault. However, optical link faults almost always cause bidirectional packet loss or complete link loss.

When download speeds are flawless but upload throughput drops by 80% to 90%, the root cause typically lies in one of three areas: **ISP optical line terminal (OLT) policer mismatch**, **TCP window scaling and buffer starvation**, or **network interface card (NIC) hardware offloading conflicts**.

Here is how to methodically diagnose and resolve asymmetrical fiber throughput issues.

---

## Diagnostic Flowchart

```
[Symptom: 940 Mbps Down / <100 Mbps Up]
   │
   ├── Step 1: Check Physical Link & Auto-Negotiation (Full Duplex vs Half Duplex)
   │
   ├── Step 2: Disable TCP Segmentation & Large Send Offload (LSO) on NIC
   │
   ├── Step 3: Run Multi-Stream UDP vs Single-Stream TCP iperf3 Tests
   │
   └── Step 4: Audit ONT Provisioning & Token Bucket Policer Parameters
```

---

## Step 1: Rule Out Local NIC Auto-Negotiation and Offload Bugs

Before contacting your ISP, verify that your client operating system and network card are not discarding upload packets locally.

### 1. Disable Large Send Offload (LSO) on Windows

Modern Gigabit and 2.5 GbE network controllers offload TCP packet segmentation from the CPU to the NIC via **Large Send Offload (LSO)**. When an optical network terminal (ONT) or residential gateway has an aggressive burst-size policer, bursts of large 64 KB offloaded frames cause immediate buffer overflow and retransmissions on the upstream path.

To disable LSO on Windows via PowerShell:

```powershell
# List current advanced adapter properties
Get-NetAdapterAdvancedProperty | Where-Object { $_.DisplayName -match "Offload" }

# Disable Large Send Offload for IPv4 and IPv6
Disable-NetAdapterLso -Name "*" -IPv4
Disable-NetAdapterLso -Name "*" -IPv6
```

On Linux:

```bash
# Check current offloading features
ethtool -k eth0 | grep -E "(tso|gso)"

# Disable TCP Segmentation Offload (TSO) and Generic Segmentation Offload (GSO)
sudo ethtool -K eth0 tso off gso off
```

After disabling LSO, run an upload speed test. If upload throughput immediately jumps to near-line rate, your NIC's segmentation engine was overflowing the intermediate switch buffers.

---

## Step 2: Inspect TCP Window Scaling & Socket Buffer Sizing

High-speed, high-bandwidth-delay-product (BDP) connections require large TCP receive and send windows. If TCP Window Scaling is disabled or restricted in your OS, a single TCP stream cannot transmit enough unacknowledged packets to fill a gigabit pipe.

### Calculate Bandwidth-Delay Product (BDP)

The formula for the required TCP buffer size is:

$$\text{BDP (Bits)} = \text{Bandwidth (bps)} \times \text{Round-Trip Time (seconds)}$$

For a 1 Gbps connection to a server with a 30 ms ping:

$$\text{BDP} = 1{,}000{,}000{,}000 \times 0.030 = 30{,}000{,}000 \text{ bits} \approx 3.75 \text{ MB}$$

If your operating system caps its TCP send buffer at 64 KB or 256 KB, your maximum theoretical upload throughput over that 30 ms latency path is capped:

$$\text{Max Throughput} = \frac{\text{Buffer Size (Bits)}}{\text{RTT (Seconds)}} = \frac{256 \times 1024 \times 8}{0.030} \approx 69.9 \text{ Mbps}$$

### Verify TCP Window Scaling on Windows

Verify that autotuning is enabled:

```cmd
netsh int tcp show global
```

Ensure the following parameter is set to `normal`:

```
Receive Window Auto-Tuning Level    : normal
```

If it is set to `disabled` or `restricted`, enable it:

```cmd
netsh int tcp set global autotuninglevel=normal
```

---

## Step 3: Run Multi-Stream vs Single-Stream Isolation

Determine whether the bottleneck is per-stream rate limiting or an absolute aggregate throttle:

1. Test on [NetSpeed](/) to observe upload throughput across 6 concurrent parallel Web Worker sockets.
2. If multi-stream upload achieves 500+ Mbps but single-stream upload is stuck at 40 Mbps, the issue is **TCP latency/congestion window throttling**, not a physical link constraint.
3. If aggregate upload across all streams hard-caps at a specific plateau (e.g. exactly 50 Mbps, 100 Mbps, or 200 Mbps), the link is being shaped by an ISP provisioning profile.

---

## Step 4: The GPON Token Bucket Policer Issue

In fiber-to-the-home (FTTH) architectures utilizing GPON (ITU-T G.984) or XGS-PON (ITU-T G.9807.1), bandwidth is allocated dynamically via **DBA (Dynamic Bandwidth Assignment)** using **T-CONTs (Transmission Containers)**.

To enforce rate tiers, ISPs configure a **Token Bucket Rate Limiter** on the Optical Line Terminal (OLT) port:
* **CIR (Committed Information Rate):** Guaranteed bandwidth.
* **PIR (Peak Information Rate):** Maximum burst speed.
* **CBS (Committed Burst Size):** The depth of the token bucket.

### Why Upload Often Suffers
When an ISP configures a 1 Gbps plan with a small CBS (e.g., 32 KB instead of 256 KB or higher), any high-speed burst from your PC immediately empties the token bucket. 

The OLT then drops all subsequent packets in that millisecond window without warning. TCP detects this as severe congestion, triggers a fast retransmit, cuts its congestion window (`cwnd`) in half, and backs off. This destructive cycle causes upload speeds to collapse to a fraction of the line rate.

### How to Prove It to Your ISP
When contacting tier-2 or tier-3 network support at your fiber provider:
1. Provide packet capture evidence (`.pcapng` via Wireshark) showing high duplicate ACKs and TCP Retransmissions occurring exclusively during upstream transmission.
2. Note that downstream throughput sustains line rate without drops, indicating zero physical layer optical faults (clean Rx optical power levels, typically -15 dBm to -22 dBm).
3. Request that the engineering desk inspect the **OLT Shaper and Policer profile for your ONT's upstream T-CONT**. In many instances, updating the upstream burst allowance (CBS/EBS) or re-provisioning the subscriber line profile restores full symmetrical Gigabit performance immediately.
