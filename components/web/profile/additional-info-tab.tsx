"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GraduationCap, Heart, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { clampToWordLimit, countWords, MAX_BIO_WORDS } from "@/lib/utils";
import { CardHeading, FIELD_CLASS } from "./card-heading";
import { EmptyStateBox } from "./empty-state-box";

export function AdditionalInfoTab() {
  const profile = useQuery(api.users.getCurrentUserProfile);
  const updateProfile = useMutation(api.users.updateProfile);

  const [isEditingBio, setIsEditingBio] = useState(false);
  const [bio, setBio] = useState("");
  const [courses, setCourses] = useState<string[]>([]);
  const [courseInput, setCourseInput] = useState("");
  const [isAddingCourse, setIsAddingCourse] = useState(false);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (profile && !synced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Existing pattern, kept as it was; to refactor so state isn't set in an effect.
      setBio(profile.bio);
      setCourses(profile.courses);
      setSynced(true);
    }
  }, [profile, synced]);

  const saveBio = async (value: string) => {
    setIsEditingBio(false);
    if (value === profile?.bio) return;
    try {
      await updateProfile({ bio: value });
      toast.success("Bio updated successfully!");
    } catch {
      toast.error("Failed to update bio. Please try again.");
    }
  };

  const persistCourses = async (next: string[]) => {
    setCourses(next);
    try {
      await updateProfile({ courses: next });
      toast.success("Courses updated successfully!");
    } catch {
      toast.error("Failed to update courses. Please try again.");
    }
  };

  const addCourse = () => {
    const value = courseInput.trim();
    setCourseInput("");
    if (!value || courses.includes(value)) return;
    persistCourses([...courses, value]);
  };

  const removeCourse = (course: string) => {
    persistCourses(courses.filter((c) => c !== course));
  };

  if (profile === undefined) {
    return (
      <Card>
        <CardContent className="space-y-4 p-8">
          <Skeleton className="mx-auto h-6 w-1/2" />
          <Skeleton className="h-[500px] w-full rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeading
        icon={UserRound}
        title="Additional Information"
        description="Write a little about yourself and courses you care about"
      />

      <CardContent className="space-y-8">
        <section>
          <h2 className="mb-3 text-base font-semibold text-primary">
            What I care about
          </h2>

          {isEditingBio ? (
            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <p className="text-sm text-muted-foreground">
                Enter your message below.
              </p>
              <Textarea
                id="bio"
                placeholder="Type your message here."
                value={bio}
                onChange={(e) =>
                  setBio(clampToWordLimit(e.target.value, MAX_BIO_WORDS))
                }
                autoFocus
                className={`${FIELD_CLASS} min-h-[192px]`}
                onBlur={() => saveBio(bio)}
              />
              <p
                className={`text-right text-xs ${
                  countWords(bio) >= MAX_BIO_WORDS
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
              >
                {countWords(bio)} / {MAX_BIO_WORDS} words
              </p>
            </div>
          ) : bio ? (
            <button
              type="button"
              onClick={() => setIsEditingBio(true)}
              className="flex min-h-[192px] w-full cursor-pointer items-start rounded-2xl border border-primary/15 px-4 py-3 text-left text-sm text-primary transition-colors hover:bg-mint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="min-w-0 whitespace-pre-wrap break-words">
                {bio}
              </span>
            </button>
          ) : (
            <EmptyStateBox
              icon={Heart}
              description="Share what you care about and connect with people who support similar causes."
              actionLabel="Add intro"
              onAction={() => setIsEditingBio(true)}
            />
          )}
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-primary">
            My featured courses
          </h2>

          {courses.length > 0 || isAddingCourse ? (
            <div className="flex min-h-28 flex-wrap content-start items-center gap-2 rounded-2xl border border-primary/15 px-4 py-3">
              {courses.map((course) => (
                <Badge
                  key={course}
                  variant="secondary"
                  className="h-auto gap-1 py-1.5 pl-3 pr-1.5 text-sm"
                >
                  {course}
                  <button
                    type="button"
                    onClick={() => removeCourse(course)}
                    aria-label={`Remove ${course}`}
                    className="rounded-full p-0.5 hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Input
                value={courseInput}
                onChange={(e) => setCourseInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCourse();
                  }
                }}
                onBlur={addCourse}
                placeholder="Type a course and press Enter"
                autoFocus={isAddingCourse}
                className="h-8 min-w-40 flex-1 border-none bg-mint px-3 shadow-none focus-visible:ring-0"
              />
            </div>
          ) : (
            <EmptyStateBox
              icon={GraduationCap}
              description="Start adding the courses and topics you care about."
              actionLabel="Add courses"
              onAction={() => setIsAddingCourse(true)}
            />
          )}
        </section>
      </CardContent>
    </Card>
  );
}
