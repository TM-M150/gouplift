"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { GraduationCap, X } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { clampToWordLimit, countWords, MAX_BIO_WORDS } from "@/lib/utils";
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
      <CardHeader>
        <CardTitle className="text-center mt-6 text-6xl font-bold">
          Additional Information
        </CardTitle>
        <CardDescription className="mt-2 text-center text-muted-foreground text-lg">
          Write a little about yourself and courses you care about
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-10">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            What I care about
          </h3>

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
                className="min-h-[192px]"
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
            <div
              onClick={() => setIsEditingBio(true)}
              className="min-h-[192px] cursor-pointer whitespace-pre-wrap rounded-xl border px-4 py-3 text-sm hover:bg-muted/40"
            >
              {bio}
            </div>
          ) : (
            <EmptyStateBox
              description="Share what you care about and connect with people who support similar causes."
              actionLabel="Add intro"
              onAction={() => setIsEditingBio(true)}
            />
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            My featured courses
          </h3>

          {courses.length > 0 || isAddingCourse ? (
            <div className="min-h-[192px] flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3">
              {courses.map((course) => (
                <Badge
                  key={course}
                  variant="secondary"
                  className="gap-1 py-1.5 pl-3 pr-1.5 text-sm"
                >
                  {course}
                  <button
                    type="button"
                    onClick={() => removeCourse(course)}
                    className="rounded-full p-0.5 hover:bg-muted-foreground/20"
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
                className="h-8 min-w-40 flex-1 border-none px-1 shadow-none focus-visible:ring-0"
              />
            </div>
          ) : (
            <EmptyStateBox
              icon={
                <GraduationCap
                  className="h-9 w-9 text-muted-foreground/40"
                  strokeWidth={1.5}
                />
              }
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
