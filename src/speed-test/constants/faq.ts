/**
 * Canonical FAQ Items for NetSpeed
 * Single Source of Truth (SSOT)
 */

export interface FAQItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FAQItem[] = [
  {
    question: "What is a good internet speed?",
    answer:
      "A good internet speed depends on what you do online. For general browsing and email, 25 Mbps is enough. For HD streaming on one device, you need about 15 Mbps. For 4K streaming, aim for 25 Mbps per stream. For video calls, 10 Mbps download and 5 Mbps upload is comfortable. A household with multiple people doing different activities simultaneously should aim for 100-300 Mbps to ensure everyone has enough bandwidth.",
  },
  {
    question: "Why is my internet speed so slow?",
    answer:
      "Slow speeds can come from many sources. WiFi interference and distance from the router are common culprits — try moving closer or using Ethernet. Background applications consuming bandwidth (cloud backups, updates, streaming on other devices) can saturate your connection. Outdated equipment (old routers or modems) may not support your plan's speeds. Network congestion during peak hours affects cable internet especially. Run a speed test on Ethernet to determine whether the problem is your WiFi or your ISP.",
  },
  {
    question: "How can I make my internet faster?",
    answer:
      "Start with the basics: restart your router and modem, connect critical devices via Ethernet, and position your router in an open, elevated location. Disconnect devices you are not using. Check for background downloads or updates consuming bandwidth. If your router supports Smart Queue Management (SQM), enable it to reduce bufferbloat. If speeds are still slow, the issue may be your ISP plan or equipment — contact them with test results from different times of day.",
  },
  {
    question: "Why doesn't my speed test match the plan I pay for?",
    answer:
      "ISPs advertise speeds as \"up to\" a certain number, measured under ideal conditions at the network level. Real-world speeds are lower due to protocol overhead (5-15%), WiFi limitations, your router's capabilities, and network congestion. A 300 Mbps plan might realistically deliver 250-270 Mbps on Ethernet and 150-200 Mbps on WiFi in the same room. Test on a wired Ethernet connection to see what your ISP actually delivers to your home, then compare against your plan.",
  },
  {
    question: "How to test internet speed accurately?",
    answer:
      "For the most accurate results: disconnect any VPN, close background applications and streaming services, connect via Ethernet if testing your line capacity, choose a test server close to your location, and run the test at different times of day to see the range. Compare results on Ethernet versus WiFi to determine whether slow speeds are caused by your wireless setup or your internet connection itself.",
  },
  {
    question: "What is latency and why does it matter?",
    answer:
      "Latency (also called ping) is the time delay in milliseconds for data to travel from your device to a server and back. Low latency under 30 ms is ideal for gaming and video calls. Between 30-50 ms is very good. Above 100 ms, you will notice delays in real-time applications. Latency matters more than speed for gaming, video conferencing, and voice calls. A fast connection with high latency will feel less responsive than a slower connection with low latency.",
  },
  {
    question: "What is bufferbloat?",
    answer:
      "Bufferbloat is a condition where latency spikes dramatically under network load due to oversized buffers in your router or ISP equipment. You might have 15 ms ping when idle, but it jumps to 300 ms when someone starts a large download. This causes lag in games, choppy video calls, and general sluggishness whenever the network is busy. The fix is enabling Smart Queue Management (SQM) on your router, which manages the buffer to prevent excessive queuing.",
  },
  {
    question: "What is jitter and how much is normal?",
    answer:
      "Jitter measures how much your latency varies over time. A stable connection has consistent ping numbers. High jitter means latency is jumping around unpredictably, which causes audio dropouts on calls, video freezing, and gaming lag spikes. Under 5 ms is excellent. Between 5-20 ms is acceptable for most uses. Above 30 ms starts degrading real-time communication. Jitter is often caused by network congestion, WiFi interference, or an overloaded router.",
  },
  {
    question: "Why is WiFi slower than Ethernet?",
    answer:
      "WiFi transmits data using radio waves that lose strength through walls, furniture, and open air. The wireless medium is shared — every device connected to the same access point competes for airtime. Interference from neighboring networks and household electronics adds noise. WiFi also has significant protocol overhead that Ethernet does not need. A WiFi connection rated at 867 Mbps might deliver only 400-500 Mbps of actual throughput. Ethernet provides a dedicated, shielded connection with minimal interference and no sharing.",
  },
  {
    question: "How often should I test my speed?",
    answer:
      "Testing once does not give you the full picture. Speeds vary throughout the day due to network congestion. Run tests at different times — morning, afternoon, and evening — on different days to see the range of your actual experience. If you are troubleshooting a problem, test both on WiFi and Ethernet. If you are evaluating whether to change your plan, collect data over a week before making a decision.",
  },
  {
    question: "What does the quality score mean?",
    answer:
      "The quality score combines all measured metrics — download speed, upload speed, latency, jitter, packet loss, and loaded latency — into a single number that reflects how the connection actually feels for everyday use. A connection with fast speeds but high bufferbloat will score lower than a connection with moderate speeds and excellent stability. The score is designed to capture the overall user experience rather than just raw bandwidth.",
  },
  {
    question: "Does NetSpeed collect or store my data?",
    answer:
      "No. NetSpeed operates with a strict no-collection policy. Your test results are processed in your browser and displayed to you. We do not store speed histories, personal details, or tracking profiles. The only data temporarily processed is your approximate geolocation (for server selection) and network metrics during the test, both of which are ephemeral. See our privacy policy for full details.",
  },
];

export const HOMEPAGE_FAQ_ITEMS = FAQ_ITEMS.slice(0, 4);
