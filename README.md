# Student Task Manager

## Original Idea

I want to create a task manager for students who need help planning their week. Users can describe their tasks in a paragraph and select their available times, and the tool will estimate task duration, difficulty, and priority and organize the tasks into a calendar.

When someone enters their tasks and available times, the experience should turn them into an editable schedule, splitting longer tasks into smaller sessions and extending beyond one week when needed.

## Final Version

The project uses HTML, CSS, and JavaScript with an English interface. Users enter one task at a time and select their available times. Local JavaScript logic estimates task duration, ranks tasks by priority, and schedules them in a weekly calendar. Longer tasks can be split into multiple sessions, and tasks that do not fit this week carry over to the next week.

The final version does not use an AI API. Its task interpretation and estimates rely on local rules.

## How to Run

It is described in the website.

## AI Tool and Selected Prompts

I used Codex to help build and revise the project. It helped generate code, investigate problems, and implement changes as the design developed.

- **Initial request:** “Help me build a browser-based task manager for students. Users should be able to describe what they need to get done this week in a paragraph and select their available times. The system should estimate how long each task will take, determine priorities, and arrange the tasks in a calendar on the page. Longer tasks can be split into smaller sessions, and tasks that do not fit this week should carry over to the next week. Start with a simple working version with an English interface.”

- **Interface and implementation:** “Please use JavaScript for the application logic, with HTML and CSS for the interface.”

- **Task entry and calendar summary:** “Allow users to enter one task at a time. Summarize each task in a short phrase in the calendar, and schedule it during their available times.”

- **Priority ranking:** “Rank tasks by priority so users can decide what to do first.”

## Reflection

The project kept my main idea of turning tasks and available times into a weekly calendar, but the input method changed during development. Originally, I wanted users to describe several tasks in one paragraph. However, the system sometimes split the description into separate tasks incorrectly. This showed that accepting natural language was not enough; the tool also needed to understand where one task ended and another began. The revised version asks users to enter one task at a time. This requires more input from the user, but reduces ambiguity. Other changes included shortening task names in the calendar to make them easier to read and changing the priority display to a ranked order so users could see what should come first.

Codex helped turn the idea into code and revise the implementation, while my role was to decide whether the behavior and presentation matched the experience I wanted. We also tried connecting a ChatGPT API to improve task interpretation, but insufficient API quota prevented that approach from being used in the final version. The project instead uses local JavaScript logic. This made it possible to continue without the API, but left limitations in how flexibly the tool can interpret tasks. The accuracy of time estimates also remains uncertain because a brief description cannot fully capture an assignment’s demands or a student’s working pace. The process helped me understand that a calendar can look organized while still depending on assumptions that need to be checked.
