import React, { useState, useRef, useEffect } from 'react'

interface AnimatedLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showFallback?: boolean
  useKishoFallback?: boolean // Use Kisho image as fallback instead of generic logo
  muted?: boolean
  loop?: boolean
  autoPlay?: boolean
  respectReducedMotion?: boolean
  autoPlayDuration?: number // Duration in milliseconds to auto-play before pausing
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
  xl: 'w-24 h-24'
}

export default function AnimatedLogo({
  size = 'md',
  className = '',
  showFallback = true,
  useKishoFallback = false,
  muted = true,
  loop = true,
  autoPlay = true,
  respectReducedMotion = true,
  autoPlayDuration
}: AnimatedLogoProps) {
  const [videoError, setVideoError] = useState(false)
  const [imgError, setImgError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [shouldPlay, setShouldPlay] = useState(autoPlay && !respectReducedMotion)
  const [isPaused, setIsPaused] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  // Check if user prefers reduced motion
  const prefersReducedMotion = respectReducedMotion &&
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Handle auto-play duration and playback speed
  useEffect(() => {
    if (autoPlayDuration && !prefersReducedMotion) {
      const timer = setTimeout(() => {
        setShouldPlay(false)
        setIsPaused(true)
        if (videoRef.current) {
          videoRef.current.pause()
        }
      }, autoPlayDuration)

      return () => clearTimeout(timer)
    }
  }, [autoPlayDuration, prefersReducedMotion])

  // Set playback speed for video elements
  useEffect(() => {
    if (videoRef.current && !prefersReducedMotion) {
      videoRef.current.playbackRate = 0.1 // Slow down to 10% speed
    }
  }, [prefersReducedMotion])

  const handleVideoError = () => {
    setVideoError(true)
    setIsLoading(false)
  }

  const handleImgError = () => {
    setImgError(true)
    setIsLoading(false)
  }

  const handleVideoLoad = () => {
    setIsLoading(false)
  }

  const handleImgLoad = () => {
    setIsLoading(false)
  }

  // Static logo for paused state
  const StaticLogo = () => (
    <div className={`${sizeClasses[size]} ${className} bg-gradient-to-br from-lamp-400 to-lamp-500 rounded-full flex items-center justify-center shadow-lg`}>
      <svg
        className="w-1/2 h-1/2 text-white"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
        />
      </svg>
    </div>
  )

  // Fallback logo when video fails or as alternative
  const FallbackLogo = () => (
    useKishoFallback ? (
      <div className={`${sizeClasses[size]} ${className} rounded-full overflow-hidden shadow-lg border-2 border-lamp-200`}>
        <img
          src="/images/kisho.jpg"
          alt="Kisho - Your AI Assistant"
          className="w-full h-full object-cover"
        />
      </div>
    ) : (
      <div className={`${sizeClasses[size]} ${className} bg-gradient-to-br from-gray-400 to-gray-600 rounded-full flex items-center justify-center shadow-lg`}>
        <svg
          className="w-1/2 h-1/2 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </div>
    )
  )

  // Show static logo if paused after auto-play duration
  if (isPaused && autoPlayDuration) {
    return <StaticLogo />
  }

  if ((videoError && imgError) && showFallback) {
    return <FallbackLogo />
  }

  return (
    <div className={`relative ${sizeClasses[size]} ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 bg-gray-200 rounded-full animate-pulse flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-lamp-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {/* Try GIF first with img tag */}
      {!imgError && (
        <img
          ref={imgRef}
          src="/animations/logo-video.gif"
          alt="Animated logo"
          className={`${sizeClasses[size]} rounded-full object-cover shadow-lg`}
          onError={handleImgError}
          onLoad={handleImgLoad}
          style={{ display: isLoading ? 'none' : 'block' }}
          aria-label="Animated logo"
          role="img"
        />
      )}

      {/* Fallback to video if GIF fails */}
      {imgError && !videoError && (
        <video
          ref={videoRef}
          className={`${sizeClasses[size]} rounded-full object-cover shadow-lg`}
          muted={muted}
          loop={loop && !prefersReducedMotion && !autoPlayDuration}
          autoPlay={shouldPlay}
          playsInline
          onError={handleVideoError}
          onLoadedData={handleVideoLoad}
          style={{ display: isLoading ? 'none' : 'block' }}
          aria-label="Animated logo"
          role="img"
        >
          <source src="/animations/flying-bird.mp4" type="video/mp4" />
          <source src="/animations/flying-bird.webm" type="video/webm" />
          Your browser does not support the video tag.
        </video>
      )}

      {videoError && !showFallback && (
        <div className="w-full h-full bg-gray-100 rounded-full flex items-center justify-center">
          <span className="text-xs text-gray-500">Logo</span>
        </div>
      )}
    </div>
  )
}
