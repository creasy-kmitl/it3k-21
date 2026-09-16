import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@it3k/ui/components/card";
import { Button } from "@it3k/ui/components/button";
import { SiGoogle } from "@icons-pack/react-simple-icons";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex justify-center items-center w-full">
      <Card className="w-sm">
        <CardHeader>
          <CardTitle className="font-bold">
            <span className="text-primary">IT3Kings</span> Staff
          </CardTitle>
          <CardDescription>
            Login to your IT3Kings staff account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className={"w-full disabled:cursor-not-allowed"} disabled>
            <SiGoogle /> Continue with Google
          </Button>
        </CardContent>
        <CardFooter>
          <p className="text-muted-foreground">Staff account is not yet available.</p>
        </CardFooter>
      </Card>
    </div>
  );
}
