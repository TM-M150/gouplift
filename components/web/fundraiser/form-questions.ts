export interface FundraiserChoice {
  value: string;
  label: string;
  description?: string;
}

export const LOCATION_CHOICES: FundraiserChoice[] = [
  { value: "Nairobi", label: "Nairobi" },
  { value: "Mombasa", label: "Mombasa" },
  { value: "Kisumu", label: "Kisumu" },
  { value: "Nakuru", label: "Nakuru" },
  { value: "Kiambu", label: "Kiambu" },
  { value: "Uasin Gishu", label: "Uasin Gishu" },
  { value: "Machakos", label: "Machakos" },
  { value: "Kajiado", label: "Kajiado" },
];

export const FUNDRAISER_TYPE_CHOICES: FundraiserChoice[] = [
  { value: "MEDICAL", label: "Medical", description: "Treatment, surgery, or recovery costs" },
  { value: "EDUCATION", label: "Education", description: "School fees, courses, or supplies" },
  { value: "EMERGENCY", label: "Emergency", description: "Urgent, unexpected needs" },
  { value: "MEMORIAL_FUNERAL", label: "Memorial & funeral", description: "Honoring and burying a loved one" },
  { value: "COMMUNITY_HARAMBEE", label: "Community harambee", description: "A shared community cause" },
  { value: "BUSINESS_STARTUP", label: "Business & startup", description: "Getting a venture off the ground" },
  { value: "SPORTS", label: "Sports", description: "Teams, athletes, and events" },
  { value: "CREATIVE_ARTS", label: "Creative & arts", description: "Film, music, art, and other projects" },
  { value: "ANIMAL_WELFARE", label: "Animal welfare", description: "Caring for animals in need" },
  { value: "ENVIRONMENT", label: "Environment", description: "Conservation and sustainability" },
  { value: "DISASTER_RELIEF", label: "Disaster relief", description: "Recovering after a disaster" },
  { value: "NONPROFIT", label: "Nonprofit", description: "Supporting a registered nonprofit" },
  { value: "OTHER", label: "Other", description: "Doesn't fit another category" },
];
 
export const BENEFICIARY_CHOICES: FundraiserChoice[] = [
  { value: "SELF", label: "Myself", description: "You're raising funds for yourself" },
  { value: "SOMEONE_ELSE", label: "Someone else", description: "A friend, relative, or another person" },
  { value: "ORGANIZATION", label: "An organization", description: "A registered group or nonprofit" },
];

export const GOAL_CHOICES: FundraiserChoice[] = [
  { value: "50000", label: "KES 50,000" },
  { value: "100000", label: "KES 100,000" },
  { value: "250000", label: "KES 250,000" },
  { value: "500000", label: "KES 500,000" },
];