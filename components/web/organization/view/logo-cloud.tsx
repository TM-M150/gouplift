"use client";

import {
  FaFacebook,
  FaXTwitter,
  FaInstagram,
  FaLinkedin,
  FaGithub,
  FaYoutube,
} from "react-icons/fa6";

export function LogoCloud() {
  const socialLogos = [
    { icon: FaFacebook, label: "Facebook" },
    { icon: FaXTwitter, label: "X (Twitter)" },
    { icon: FaInstagram, label: "Instagram" },
    { icon: FaLinkedin, label: "LinkedIn" },
    { icon: FaGithub, label: "GitHub" },
    { icon: FaYoutube, label: "YouTube" },
  ];

  return (
    <section className="bg-background py-6">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-wrap items-center justify-center gap-8 md:justify-between md:gap-12 text-foreground">
          {socialLogos.map(({ icon: Icon, label }) => (
            <Icon
              key={label}
              size={32}
              aria-label={label}
              className="text-muted-foreground hover:text-foreground transition-colors"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
