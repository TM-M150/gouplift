"use client";

import Image from "next/image";

interface HeroMediaProps {
  videoUrl?: string;
  imageUrl?: string;
}

const DEFAULT_UNSPLASH_IMAGE =
  "https://images.unsplash.com/photo-1642573528457-112851dc12e0?q=80&w=1332&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D";

export function HeroMedia({ videoUrl, imageUrl }: HeroMediaProps) {
  if (videoUrl) {
    return (
      <video
        aria-hidden
        autoPlay
        muted
        loop
        playsInline
        className="size-full object-cover brightness-50"
        src={videoUrl}
        onLoadedMetadata={(event) => {
          event.currentTarget.playbackRate = 0.5;
        }}
      />
    );
  }

  const bgImage = imageUrl || DEFAULT_UNSPLASH_IMAGE;

  return (
    <div className="relative size-full">
      <Image
        src={bgImage}
        alt="Hero Background"
        fill
        priority
        className="object-cover brightness-50"
      />
    </div>
  );
}
