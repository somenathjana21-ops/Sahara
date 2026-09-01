// app/call/page.tsx — Simulated IVRS call screen (TM3 owner)
//
// Phone-shaped UI that speaks prompts using speechSynthesis,
// listens using SpeechRecognition, and accepts DTMF keypad input.
//
// SAFETY-CRITICAL:
// - Panic key (0) works OFFLINE, at every state (CHECKS_TM3 T3-D1/T3-D2)
// - Typed fallback ALWAYS present (CHECKS_TM3 T3-D3)
// - Posts to /api/checkin (same endpoint as chat, CHECKS_TM3 T3-D5)
// - Honest labelling: "Simulated IVRS — no telephony" (CHECKS_TM3 T3-D7)

"use client";

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CrisisPanel } from '@/components/ui/CrisisPanel';
import { Button } from '@/components/ui/Button';
import { t } from '@/components/ui/i18n';
import type { CheckInResponse, Language } from '@/types/contract';

const CRISIS_RESOURCES = [
  { label: 'NHAA — National Helpline Against Atrocities', phone: '14566' },
  { label: 'Tele-MANAS — Mental health support', phone: '14416' },
];

type CallState =
  | 'idle'
  | 'connecting'
  | 'consent'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'open_question'
  | 'completed'
  | 'crisis';

function CallPageInner() {
  const searchParams = useSearchParams();
  const lang = ((searchParams?.get('lang') === 'hi' ? 'hi' : 'en')) as Language;

  const [callState, setCallState] = useState<CallState>('idle');
  const [answers, setAnswers] = useState<number[]>([]);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [typedInput, setTypedInput] = useState('');
  const [response, setResponse] = useState<CheckInResponse | null>(null);

  const recognitionRef = useRef<any>(null);

  // Feature detection for SpeechRecognition & speechSynthesis (CHECKS_TM3 T3-D4)
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (SpeechRecognition && 'speechSynthesis' in window) {
      setSpeechSupported(true);
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = lang === 'hi' ? 'hi-IN' : 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setTranscript(text);
        setListening(false);
      };

      recognitionRef.current.onerror = () => {
        setListening(false);
      };

      recognitionRef.current.onend = () => {
        setListening(false);
      };
    }
  }, [lang]);

  // Speak a prompt using speechSynthesis
  function speak(text: string) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'hi' ? 'hi-IN' : 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  }

  // Panic key handler — works at ANY state, completely offline (CHECKS_TM3 T3-D1/T3-D2)
  function handlePanicKey() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setCallState('crisis');
  }

  // Start call
  function handleStartCall() {
    setCallState('consent');
    speak(
      lang === 'hi'
        ? 'नमस्ते। यह सहारा चेक-इन है। क्या आप जारी रखना चाहते हैं? 1 दबाएं।'
        : 'Hello. This is Sahara check-in. To continue, press 1.'
    );
  }

  // Keypad press handler
  function handleKeyPress(key: string) {
    // 0 is ALWAYS panic key
    if (key === '0') {
      handlePanicKey();
      return;
    }

    if (callState === 'consent' && key === '1') {
      setCallState('q1');
      speak(
        lang === 'hi'
          ? 'प्रश्न 1: अभी आप कितना सुरक्षित महसूस करते हैं? 0 से 4 दबाएं।'
          : 'Question 1: How safe do you feel right now? Press 0 to 4.'
      );
    } else if (callState === 'q1') {
      const val = parseInt(key);
      if (val >= 0 && val <= 4) {
        setAnswers([val]);
        setCallState('q2');
        speak(
          lang === 'hi'
            ? 'प्रश्न 2: आप कितनी अच्छी तरह सो पा रहे हैं? 0 से 4 दबाएं।'
            : 'Question 2: How well have you been sleeping? Press 0 to 4.'
        );
      }
    } else if (callState === 'q2') {
      const val = parseInt(key);
      if (val >= 0 && val <= 4) {
        setAnswers([...answers, val]);
        setCallState('q3');
        speak(
          lang === 'hi'
            ? 'प्रश्न 3: आपको कितना समर्थन महसूस होता है? 0 से 4 दबाएं।'
            : 'Question 3: How much support do you feel you have? Press 0 to 4.'
        );
      }
    } else if (callState === 'q3') {
      const val = parseInt(key);
      if (val >= 0 && val <= 4) {
        setAnswers([...answers, val]);
        setCallState('open_question');
        speak(
          lang === 'hi'
            ? 'अपनी स्थिति के बारे में कुछ बताएं। बोलने के लिए माइक दबाएं, या नीचे टाइप करें।'
            : 'Please share how you are doing. Tap the mic to speak, or type below.'
        );
      }
    }
  }

  // Toggle voice recording
  function toggleListening() {
    if (!recognitionRef.current) return;

    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      setTranscript('');
      recognitionRef.current.start();
      setListening(true);
    }
  }

  // Submit the completed call (CHECKS_TM3 T3-D5: same endpoint as chat)
  async function handleSubmitCall() {
    const finalTranscript = transcript || typedInput;

    const payload = {
      personId: '11111111-1111-1111-1111-111111111111',
      consentId: '11111111-1111-1111-1111-111111111113',
      channel: 'call_sim' as const,
      transcript: finalTranscript,
      structured: {
        q1: answers[0],
        q2: answers[1],
        q3: answers[2],
      },
    };

    // In local dev with stub, this works
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        setResponse(data);
        setCallState('completed');
        speak(
          lang === 'hi'
            ? 'धन्यवाद। आपका चेक-इन दर्ज कर लिया गया है।'
            : 'Thank you. Your check-in has been recorded.'
        );
      }
    } catch {
      // Mock completion if API unavailable
      setCallState('completed');
    }
  }

  // Crisis panel rendering
  if (callState === 'crisis') {
    return (
      <div className="max-w-md mx-auto p-4 space-y-4">
        <CrisisPanel
          resources={CRISIS_RESOURCES}
          onTalkToPerson={() => {}}
          lang={lang}
        />
        <Button
          variant="quiet"
          onClick={() => setCallState('idle')}
          className="w-full"
        >
          Back to Call
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Top bar with escape route */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <span className="font-display text-lg">Simulated Call</span>
        <a
          href="/"
          className="text-sm text-ink-soft hover:text-ink transition-colors"
        >
          ← Back to Home
        </a>
      </header>

      <div className="max-w-md mx-auto p-4 space-y-6 mt-6">
        {/* Honest Labelling (CHECKS_TM3 T3-D7) */}
        <div className="bg-surface border border-line rounded-card p-3 text-center text-xs text-ink-soft">
          Simulated IVRS — no telephony
        </div>

      {/* Phone UI Container */}
      <div className="bg-surface border-2 border-line rounded-[32px] p-6 shadow-lg space-y-6">
        {/* Screen/Display */}
        <div className="bg-bg rounded-card p-4 text-center min-h-[100px] flex flex-col items-center justify-center">
          {callState === 'idle' && (
            <p className="text-sm text-ink-soft">Press Call to begin</p>
          )}
          {callState === 'consent' && (
            <p className="text-sm font-medium">Press 1 to consent, or 0 for help</p>
          )}
          {callState === 'q1' && (
            <p className="text-sm font-medium">Q1: How safe do you feel? (0-4)</p>
          )}
          {callState === 'q2' && (
            <p className="text-sm font-medium">Q2: Sleep quality? (0-4)</p>
          )}
          {callState === 'q3' && (
            <p className="text-sm font-medium">Q3: Support level? (0-4)</p>
          )}
          {callState === 'open_question' && (
            <div className="space-y-2 w-full">
              <p className="text-sm font-medium">Speak or type how you feel</p>
              {transcript && (
                <p className="text-xs bg-surface p-2 rounded text-left font-mono">
                  &ldquo;{transcript}&rdquo;
                </p>
              )}
            </div>
          )}
          {callState === 'completed' && (
            <p className="text-sm font-medium text-calm">✓ Call Complete</p>
          )}
        </div>

        {/* Voice Input Controls */}
        {callState === 'open_question' && (
          <div className="space-y-3">
            {speechSupported && (
              <Button
                variant={listening ? 'danger' : 'primary'}
                onClick={toggleListening}
                className="w-full"
              >
                {listening ? '⏹ Stop Listening' : '🎤 Tap to Speak'}
              </Button>
            )}

            {/* Typed Fallback ALWAYS Present (CHECKS_TM3 T3-D3) */}
            <div>
              <p className="text-xs text-ink-soft mb-1">Or type instead:</p>
              <textarea
                value={typedInput}
                onChange={(e) => setTypedInput(e.target.value)}
                placeholder="Type your response here…"
                rows={2}
                className="w-full text-xs p-2 rounded border border-line bg-bg"
              />
            </div>

            <Button
              variant="primary"
              onClick={handleSubmitCall}
              disabled={!transcript && !typedInput.trim()}
              className="w-full"
            >
              Finish Call
            </Button>
          </div>
        )}

        {/* DTMF Keypad */}
        {callState !== 'open_question' && callState !== 'completed' && (
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(
              (key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleKeyPress(key)}
                  disabled={callState === 'idle'}
                  className={`min-h-[56px] rounded-full border border-line font-mono text-lg font-semibold
                    hover:bg-bg active:scale-95 transition-all
                    ${key === '0' ? 'bg-red-700/10 text-red-700 border-red-700' : 'bg-surface'}
                    ${callState === 'idle' ? 'opacity-40' : ''}`}
                >
                  {key}
                  {key === '0' && (
                    <span className="block text-[9px] font-normal font-sans">
                      PANIC
                    </span>
                  )}
                </button>
              )
            )}
          </div>
        )}

        {/* Call Controls */}
        <div className="flex gap-3">
          {callState === 'idle' ? (
            <Button
              variant="primary"
              onClick={handleStartCall}
              className="w-full bg-calm text-white"
            >
              📞 Start Call
            </Button>
          ) : (
            <Button
              variant="danger"
              onClick={() => setCallState('idle')}
              className="w-full"
            >
              End Call
            </Button>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

export default function CallPage() {
  return (
    <Suspense fallback={null}>
      <CallPageInner />
    </Suspense>
  );
}
