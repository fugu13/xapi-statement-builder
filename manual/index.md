# xAPI Statement Builder

There are a lot of easy mistakes to make when writing xAPI Statements. The xAPI Statement Builder Library tries to make mistakes harder to make, and good practices easier to follow.

## Key Features

#### "Builder" patterns

To make a Statement, just keep chaining builder methods, as in `statement.withActorEmail("zeynep@example.org").withActorName("Zeynep")`.

#### Profile lookup support

`statement.withProfile(...)` followed later by `statement.withObjectActivityType("Course")` looks up the Activity Type named "Course" in the Profile you registered to get the Activity Type IRI -- and errors if you made a typo in the Activity Type name

#### Profile Pattern & Statement Template support

If you use the library to build a sequence of Statements following a Profile Pattern, the library will validate they're in an allowed order, and validate the contents of each Statement match the Statement's Template.

#### Smart Statements

Timestamp and Statement id are automatically filled in (but you can override any time), and many possible errors are not possible if you use the builder methods.
