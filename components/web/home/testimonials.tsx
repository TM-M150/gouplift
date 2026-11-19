import Link from "next/link";
import { Quote } from "lucide-react";
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
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-7xl space-y-8 px-6 md:space-y-12">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-balance text-4xl font-medium tracking-tight lg:text-5xl">
            What people say about GoUplift
          </h2>
          <p className="text-muted-foreground">
            Shared by people whose identity we have verified, and read by our
            team before they appear here.
          </p>
        </div>

        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((testimonial) => (
            <li key={testimonial._id}>
              <figure className="flex h-full flex-col justify-between gap-6 rounded-xl border bg-card p-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <Quote
                      aria-hidden
                      className="h-5 w-5 text-muted-foreground"
                    />
                    {testimonial.rating !== null && (
                      <StarRating rating={testimonial.rating} />
                    )}
                  </div>
                  <blockquote className="text-pretty whitespace-pre-line break-words">
                    {testimonial.message}
                  </blockquote>
                </div>
                <figcaption className="text-sm">
                  <span className="font-medium">{testimonial.authorName}</span>
                  {testimonial.fundraiserId && testimonial.fundraiserTitle && (
                    <span className="text-muted-foreground">
                      {" on "}
                      <Link
                        href={`/fundraiser/${testimonial.fundraiserId}`}
                        className="underline underline-offset-2 hover:text-foreground"
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
      </div>
    </section>
  );
}
