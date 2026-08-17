import FundraiserForm from "@/components/web/fundraiser/fundraiser-form";

export default function CreateFundraiserPage() {
  return (
    <main className="min-h-screen max-w-5xl mx-auto w-full pt-24 px-4 pb-16">
      <div className="mb-8 space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Start a fundraiser
        </h1>
        <p className="text-muted-foreground">
          Tell your story, set a goal, and start raising support.
        </p>
      </div>

      <FundraiserForm />
    </main>
  );
}