import Link from "next/link";
import { Quote } from "lucide-react";

import { HomeSection, SectionHeading } from "@/components/web/home/section";
import { StarRating } from "@/components/web/testimonials/star-rating";

export interface TestimonialData {
  _id: string;
  message: string;
  rating: number | null;
  authorName: string;
  // Only an older testimonial, from a donation, is about a fundraiser.
  fundraiserId: string | null;
  fundraiserTitle: string | null;
}

/**
 * What people say about GoUplift: testimonials from people whose identity we
 * have verified, after staff approved the wording. Renders nothing, heading
 * included, until there is at least one, so the page never shows an empty or
 * made-up "what people say".
 */
export function Testimonials({
  testimonials,
}: {
  testimonials: TestimonialData[];
}) {
  if (testimonials.length === 0) return null;

  return (
    <HomeSection tone="mint" labelledBy="testimonials-title">
      <SectionHeading
        id="testimonials-title"
        title="What people say about GoUplift"
        lead="Shared by people whose identity we have verified, and read by our team before they appear here."
      />

      <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((testimonial) => (
          <li key={testimonial._id}>
            <figure className="flex h-full flex-col justify-between gap-6 rounded-3xl bg-white p-6 sm:p-7">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span
                    aria-hidden
                    className="flex size-10 items-center justify-center rounded-xl bg-primary text-secondary"
                  >
                    <Quote className="size-5" />
                  </span>
                  {testimonial.rating !== null && (
                    <StarRating
                      rating={testimonial.rating}
                      filledClassName="fill-secondary text-primary"
                    />
                  )}
                </div>
                <blockquote className="text-pretty whitespace-pre-line break-words">
                  {testimonial.message}
                </blockquote>
              </div>
              <figcaption className="text-sm">
                <span className="font-medium">{testimonial.authorName}</span>
                {testimonial.fundraiserId && testimonial.fundraiserTitle && (
                  <span className="text-primary/70">
                    {" on "}
                    <Link
                      href={`/fundraiser/${testimonial.fundraiserId}`}
                      className="underline underline-offset-2 hover:text-primary"
                    >
                      {testimonial.fundraiserTitle}
                    </Link>
                  </span>
                )}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}
