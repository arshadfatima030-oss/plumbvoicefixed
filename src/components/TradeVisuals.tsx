import {Flame, Home, Phone, ShieldCheck, Tablet, Truck, Wrench, Zap} from 'lucide-react';

export type TradeSceneVariant =
  | 'kitchen-sink'
  | 'water-heater'
  | 'copper-pipes'
  | 'electrical-panel'
  | 'outlet-install'
  | 'service-van'
  | 'homeowner-call'
  | 'contractor-phone'
  | 'tablet-leads'
  | 'owner-desk';

interface TradeSceneProps {
  variant: TradeSceneVariant;
  alt: string;
  className?: string;
  kenBurns?: boolean;
}

const SCENE_META: Record<
  TradeSceneVariant,
  {
    eyebrow: string;
    caption: string;
    bgFrom: string;
    bgTo: string;
    accent: string;
  }
> = {
  'kitchen-sink': {
    eyebrow: 'Under-Sink Copper Supply',
    caption: 'Plumber inspecting angle stop & brass compression assembly',
    bgFrom: '#23272B',
    bgTo: '#14171A',
    accent: '#C8672B',
  },
  'water-heater': {
    eyebrow: 'Tankless & Tank Service',
    caption: 'Licensed technician servicing copper manifold & expansion valve',
    bgFrom: '#26211D',
    bgTo: '#181A1D',
    accent: '#C8672B',
  },
  'copper-pipes': {
    eyebrow: 'Precision Copper Craft',
    caption: 'Type-L copper risers, ProPress couplings & ball shutoffs',
    bgFrom: '#2B1E17',
    bgTo: '#17191C',
    accent: '#C8672B',
  },
  'electrical-panel': {
    eyebrow: '200A Main Service Panel',
    caption: 'Master electrician performing thermal lug & breaker load check',
    bgFrom: '#1E2126',
    bgTo: '#121417',
    accent: '#F2A93B',
  },
  'outlet-install': {
    eyebrow: 'GFCI & Circuit Safety',
    caption: 'Dedicated 20A kitchen GFCI & arc-fault breaker verification',
    bgFrom: '#24221C',
    bgTo: '#16181B',
    accent: '#F2A93B',
  },
  'service-van': {
    eyebrow: 'Suburban Fleet Dispatch',
    caption: 'Stocked service truck arriving at residential job site',
    bgFrom: '#22262A',
    bgTo: '#15181B',
    accent: '#C8672B',
  },
  'homeowner-call': {
    eyebrow: '24/7 Homeowner Intake',
    caption: 'Immediate calm answer before caller dials a competitor',
    bgFrom: '#2B241E',
    bgTo: '#191C1F',
    accent: '#C8672B',
  },
  'contractor-phone': {
    eyebrow: 'On-Site SMS Dispatch',
    caption: 'Contractor receiving verified address & urgency alert in the field',
    bgFrom: '#212529',
    bgTo: '#141619',
    accent: '#F2A93B',
  },
  'tablet-leads': {
    eyebrow: 'Field Lead Review',
    caption: 'Technician reviewing captured call transcript & job history',
    bgFrom: '#24272B',
    bgTo: '#16181B',
    accent: '#C8672B',
  },
  'owner-desk': {
    eyebrow: 'Back-Office Operations',
    caption: 'Owner tracking booked revenue & zero missed calls',
    bgFrom: '#25211D',
    bgTo: '#17191C',
    accent: '#C8672B',
  },
};

export function TradeSceneArtwork({
  variant,
  alt,
  className = '',
  kenBurns = false,
}: TradeSceneProps) {
  const meta = SCENE_META[variant];

  return (
    <div
      role="img"
      aria-label={alt}
      className={`relative overflow-hidden select-none ${className}`}
      style={{
        background: `radial-gradient(circle at 75% 25%, ${meta.accent}33 0%, transparent 55%), linear-gradient(145deg, ${meta.bgFrom} 0%, ${meta.bgTo} 100%)`,
      }}
    >
      {/* Subtle architectural blueprint grid */}
      <svg
        viewBox="0 0 640 400"
        className={`w-full h-full object-cover opacity-90 ${
          kenBurns ? 'animate-[kenburns_18s_ease-in-out_infinite_alternate]' : ''
        }`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern id={`grid-${variant}`} width="32" height="32" patternUnits="userSpaceOnUse">
            <path
              d="M 32 0 L 0 0 0 32"
              fill="none"
              stroke="rgba(250,247,242,0.06)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="640" height="400" fill={`url(#grid-${variant})`} />

        {/* Trade-specific warm architectural illustration */}
        {(variant === 'kitchen-sink' || variant === 'copper-pipes' || variant === 'water-heater') && (
          <g strokeLinecap="round" strokeLinejoin="round">
            {/* Copper piping manifold */}
            <path
              d="M 90 310 L 90 150 Q 90 120 120 120 L 290 120 Q 320 120 320 150 L 320 265"
              fill="none"
              stroke="#C8672B"
              strokeWidth="18"
            />
            <path
              d="M 90 310 L 90 150 Q 90 120 120 120 L 290 120 Q 320 120 320 150 L 320 265"
              fill="none"
              stroke="#E89A67"
              strokeWidth="4"
              opacity="0.55"
            />
            <path
              d="M 190 120 L 190 250 Q 190 280 220 280 L 470 280"
              fill="none"
              stroke="#B55A22"
              strokeWidth="14"
            />
            {/* Brass ProPress couplings & shutoff valve */}
            <rect x="175" y="106" width="30" height="28" rx="4" fill="#F2A93B" />
            <rect x="305" y="180" width="30" height="36" rx="4" fill="#F2A93B" />
            <line x1="335" y1="198" x2="380" y2="198" stroke="#FAF7F2" strokeWidth="6" />
            {/* Pressure gauge */}
            <circle cx="465" cy="145" r="46" fill="#1C1F22" stroke="#C8672B" strokeWidth="5" />
            <circle cx="465" cy="145" r="34" fill="#FAF7F2" />
            <line x1="465" y1="145" x2="486" y2="127" stroke="#C8672B" strokeWidth="4" />
            <circle cx="465" cy="145" r="5" fill="#1C1F22" />
          </g>
        )}

        {(variant === 'electrical-panel' || variant === 'outlet-install') && (
          <g strokeLinecap="round" strokeLinejoin="round">
            {/* 200A Panel Enclosure */}
            <rect
              x="160"
              y="56"
              width="320"
              height="288"
              rx="10"
              fill="#23282D"
              stroke="#484E54"
              strokeWidth="4"
            />
            <rect x="184" y="80" width="272" height="240" rx="6" fill="#171A1D" />
            {/* Main 200A Breaker */}
            <rect x="275" y="96" width="90" height="34" rx="4" fill="#C8672B" />
            {/* Branch Breakers Left & Right */}
            {[0, 1, 2, 3, 4].map((row) => (
              <g key={row}>
                <rect
                  x="204"
                  y={148 + row * 30}
                  width="92"
                  height="20"
                  rx="3"
                  fill={row === 1 ? '#F2A93B' : '#32383E'}
                />
                <rect
                  x="344"
                  y={148 + row * 30}
                  width="92"
                  height="20"
                  rx="3"
                  fill={row === 2 ? '#C8672B' : '#32383E'}
                />
              </g>
            ))}
            {/* Copper Busbars */}
            <rect x="308" y="140" width="8" height="162" fill="#C8672B" />
            <rect x="324" y="140" width="8" height="162" fill="#F2A93B" />
          </g>
        )}

        {(variant === 'service-van' ||
          variant === 'homeowner-call' ||
          variant === 'contractor-phone' ||
          variant === 'tablet-leads' ||
          variant === 'owner-desk') && (
          <g strokeLinecap="round" strokeLinejoin="round">
            {/* Warm architectural silhouette + signal waves */}
            <path
              d="M 80 310 L 560 310"
              stroke="rgba(250,247,242,0.22)"
              strokeWidth="3"
            />
            <path
              d="M 150 310 L 150 185 L 270 110 L 390 185 L 390 310"
              fill="#23282D"
              stroke="#C8672B"
              strokeWidth="3"
            />
            <rect x="242" y="220" width="56" height="90" rx="3" fill="#C8672B" opacity="0.85" />
            <rect x="180" y="205" width="42" height="42" rx="4" fill="#F2A93B" opacity="0.7" />
            <rect x="318" y="205" width="42" height="42" rx="4" fill="#F2A93B" opacity="0.7" />
            {/* Service Truck Silhouette */}
            <rect x="370" y="232" width="145" height="62" rx="8" fill="#FAF7F2" />
            <path d="M 515 248 L 552 248 L 564 274 L 564 294 L 515 294 Z" fill="#C8672B" />
            <circle cx="412" cy="298" r="16" fill="#1C1F22" stroke="#FAF7F2" strokeWidth="4" />
            <circle cx="534" cy="298" r="16" fill="#1C1F22" stroke="#FAF7F2" strokeWidth="4" />
            {/* Acoustic reception arcs */}
            <path
              d="M 455 130 A 55 55 0 0 1 510 185"
              fill="none"
              stroke="#F2A93B"
              strokeWidth="4"
              opacity="0.75"
            />
            <path
              d="M 455 102 A 83 83 0 0 1 538 185"
              fill="none"
              stroke="#C8672B"
              strokeWidth="4"
              opacity="0.6"
            />
          </g>
        )}
      </svg>

      {/* Dark Charcoal Scrim Overlay ensuring crisp contrast */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-[#1C1F22]/90 via-[#1C1F22]/30 to-transparent pointer-events-none"
        aria-hidden="true"
      />

      {/* Contextual Domain Caption Badge */}
      <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3 pointer-events-none">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#F2A93B]">
            {variant === 'electrical-panel' || variant === 'outlet-install' ? (
              <Zap className="w-3.5 h-3.5" />
            ) : variant === 'service-van' ? (
              <Truck className="w-3.5 h-3.5" />
            ) : variant === 'homeowner-call' ? (
              <Home className="w-3.5 h-3.5" />
            ) : variant === 'contractor-phone' ? (
              <Phone className="w-3.5 h-3.5" />
            ) : variant === 'tablet-leads' ? (
              <Tablet className="w-3.5 h-3.5" />
            ) : variant === 'water-heater' ? (
              <Flame className="w-3.5 h-3.5" />
            ) : variant === 'owner-desk' ? (
              <ShieldCheck className="w-3.5 h-3.5" />
            ) : (
              <Wrench className="w-3.5 h-3.5" />
            )}
            <span>{meta.eyebrow}</span>
          </div>
          <p className="text-[13px] font-medium text-[#FAF7F2]/90 mt-0.5 line-clamp-1">
            {meta.caption}
          </p>
        </div>
      </div>
    </div>
  );
}
