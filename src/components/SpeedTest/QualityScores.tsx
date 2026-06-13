import React from 'react';
import InfoTooltip from './InfoTooltip';
import type { TestPhase } from '../../utils/speedTestUtils';

interface QualityScoresProps {
  phase: TestPhase;
  downloadAvg: number; // bps
  uploadAvg: number; // bps
  latencyAvg: number; // ms
  latencyJitter: number; // ms
}

export default function QualityScores({
  phase,
  downloadAvg,
  uploadAvg,
  latencyAvg,
  latencyJitter
}: QualityScoresProps) {
  const getQualityScores = () => {
    const dlMbps = downloadAvg / 1000000;
    const ulMbps = uploadAvg / 1000000;
    const lat = latencyAvg;
    const jit = latencyJitter;

    // 1. Initial/idle states
    if (phase === 'idle' || phase === 'routing') {
      return {
        streaming: { rating: '—', color: 'text-mute' },
        gaming: { rating: '—', color: 'text-mute' },
        chatting: { rating: '—', color: 'text-mute' }
      };
    }

    // 2. Video Streaming (needs download speed)
    let streamingRating = 'Evaluating…';
    let streamingColor = 'text-mute';
    if (phase === 'download' || phase === 'upload' || phase === 'complete') {
      if (dlMbps >= 25) {
        streamingRating = 'Great';
        streamingColor = 'text-link';
      } else if (dlMbps >= 5) {
        streamingRating = 'Good';
        streamingColor = 'text-link';
      } else if (dlMbps > 0) {
        streamingRating = 'Bad';
        streamingColor = 'text-error';
      }
    }

    // 3. Online Gaming (needs latency)
    let gamingRating = 'Evaluating…';
    let gamingColor = 'text-mute';
    if (lat > 0) {
      if (lat <= 30 && jit <= 10) {
        gamingRating = 'Great';
        gamingColor = 'text-link';
      } else if (lat <= 80 && jit <= 30) {
        gamingRating = 'Good';
        gamingColor = 'text-link';
      } else {
        gamingRating = 'Bad';
        gamingColor = 'text-error';
      }
    }

    // 4. Video Chatting (needs latency, download, and upload speeds)
    let chattingRating = 'Evaluating…';
    let chattingColor = 'text-mute';
    if (phase === 'upload' || phase === 'complete') {
      const meetsSpeed = dlMbps >= 4 && ulMbps >= 1.5;
      const meetsLatency = lat <= 120;
      if (meetsSpeed && meetsLatency) {
        chattingRating = (dlMbps >= 10 && ulMbps >= 3 && lat <= 50) ? 'Great' : 'Good';
        chattingColor = 'text-link';
      } else {
        chattingRating = 'Bad';
        chattingColor = 'text-error';
      }
    }

    return {
      streaming: { rating: streamingRating, color: streamingColor },
      gaming: { rating: gamingRating, color: gamingColor },
      chatting: { rating: chattingRating, color: chattingColor }
    };
  };

  const scores = getQualityScores();

  return (
    <div className="bg-canvas border border-hairline p-6 rounded-lg shadow-xs">
      <div className="flex items-center gap-1.5 text-xs text-mute font-mono mb-4 pb-2 border-b border-hairline">
        <span>NETWORK QUALITY SCORE</span>
        <InfoTooltip content="Estimates how well your current connection supports common online tasks based on speeds and latency scores." />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center divide-y sm:divide-y-0 sm:divide-x divide-hairline">
        <div className="pt-4 sm:pt-0 sm:px-4 flex flex-col justify-center gap-1">
          <span className="text-xs font-mono text-mute uppercase tracking-wider">Video Streaming</span>
          <span className={`text-lg font-bold transition-colors duration-150 ${scores.streaming.color}`}>
            {scores.streaming.rating}
          </span>
        </div>

        <div className="pt-4 sm:pt-0 sm:px-4 flex flex-col justify-center gap-1">
          <span className="text-xs font-mono text-mute uppercase tracking-wider">Online Gaming</span>
          <span className={`text-lg font-bold transition-colors duration-150 ${scores.gaming.color}`}>
            {scores.gaming.rating}
          </span>
        </div>

        <div className="pt-4 sm:pt-0 sm:px-4 flex flex-col justify-center gap-1">
          <span className="text-xs font-mono text-mute uppercase tracking-wider">Video Chatting</span>
          <span className={`text-lg font-bold transition-colors duration-150 ${scores.chatting.color}`}>
            {scores.chatting.rating}
          </span>
        </div>
      </div>
    </div>
  );
}
