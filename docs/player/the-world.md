# The world

## Days, weeks and seasons {#calendar}

The household clock shows the day and weekday, time, then season and weather. A new game starts on Day 1, Monday, in Spring. Weekdays run Monday through Sunday and continue as the household clock advances.

Spring, Summer, Autumn and Winter follow in that order. Each currently lasts seven game days, making a year four weeks long. The calendar has no months. Job schedules use named working days rather than assuming every career takes the weekend off.

Pause freezes game time. Speed changes how quickly the clock advances, including activity progress and weather animation. Loading a household restores its clock and the corresponding season.

Switching tabs or minimizing the browser does not itself pause the household. Browser power-saving can still suspend a background tab, and the game does not make up that lost time. See [time controls](home-and-controls/#camera-and-speed).

:::numbers Numbers and limits
A game day has {{number:tuning.day_ticks}} game minutes. Each season lasts {{number:tuning.days_per_season}} days and there are four seasons per year. At normal speed, one real second advances ten game minutes; higher speed runs more game minutes per second. Reading the guide or an open Options panel does not itself stop time.
:::

## Weather you can see {#weather}

Most weather periods are mild. Summer can have a hot period, Autumn can have breezy falling leaves, and Winter can have snow. Spring stays mild. The clock names the current condition even when reduced motion hides particles.

Autumn leaves flutter down and remain on outdoor ground for a while before fading.

:::illustration weather-autumn-grounded

Snow falls during its event and does not accumulate. Grass stays green with a subtle seasonal color shift. House flooring, street surfaces and laid floor coverings keep their own colors.

:::illustration weather-winter-snow

Weather is currently visual. Heat, snow and leaves do not change needs, mood, work, chores or plant growth. Leaves are not dirty dishes or floor grime and do not create a cleaning duty. The effect appears outdoors rather than over the cutaway interior.

:::numbers Numbers and limits
Current weather events last {{number:tuning.weather.event_hours}} game hours. On a 0 to 1 probability scale, a Summer day has chance {{number:tuning.weather.event_day_chance.1}} of a hot period, Autumn {{number:tuning.weather.event_day_chance.2}} of leaf fall, and Winter {{number:tuning.weather.event_day_chance.3}} of snow. Events begin between {{number:tuning.weather.earliest_hour}}:00 and {{number:tuning.weather.latest_hour}}:00. This is a chance per day, not a guarantee for every day of a season.
:::

## Work, pay and days off {#careers}

Careers have paths and levels with their own pay range. Open [Career](ui-elements/#career) inside Sim details to inspect the selected person's shift, performance factors and reviews. The office, cafe, night watch, hospital, warehouse, library, restaurant kitchen and buses paths have different demands.

Each job is worked on a shift: a day, early, late or night shift with its own hours and working days. Most careers offer more than one shift, and a new hire is given one by chance, weighted by how common that shift is in the career; office work is nearly always a weekday day shift. You can pick the shift when you assign a career, and change an employed person's shift while they are at home. Their old shift is still worked that day if it has not started yet. Nobody works two shifts in one day, so a new shift or a newly assigned job starts on a day after the day their last shift ended; after a night shift that ends in the morning, that can be two days later. Changing shift resets the good weeks counted toward their next promotion; pay, level and job satisfaction stay the same. A shift starting late on Sunday counts in the week it starts.

A shift's kind moves when the person wants to sleep, on working days and days off alike. Night workers sleep during the day, early workers go to bed about an hour earlier and late workers about two hours later. Older saved games keep every job on its usual hours.

:::illustration sim-career

A person commutes to an off-lot job and returns after the shift. Work has an Energy cost and slows ordinary need loss while at work; it supplies no direct need refill. Commuting uses ordinary need loss. Days off use normal household rules.

Your orders can delay a shift or bring someone home. The scheduled end does not move later to compensate, so actual attendance affects pay and performance. Career assignment and quitting are unavailable while the person is at work or commuting.

Weekly reviews use performance and a limited random contribution. Good results can bring a raise or promotion; poor runs can bring demotion and eventually dismissal. A promotion or demotion keeps the person's shift when the new level offers it. Turning off automatic career changes does not turn off reviews. A person's automatic job search is controlled separately in their own Career tab. A person looking for work tries careers by chance, favoring the ones that suit their traits.

## The house and Outside {#home-and-outside}

Confirmed walls and doorways define the home's rooms. Room names help you identify spaces and chore areas. Outside is one shared named area for the yard and other outdoor tiles, but distant people outdoors do not gain passive friendship merely because they share that name.

Doorways permit travel and daylight. Windows permit daylight while blocking travel. Furniture placement and construction must preserve usable routes. [Build](home-and-controls/#build) keeps edits in a draft until you confirm them.

Floor grime comes from actual use on eligible flooring. Grass and street do not accumulate it. Surfaces can become dirty through use, and food preparation creates dishes and bin waste. These are household work rather than seasonal weather effects.

## Death and grief {#death}

With Sims can die if hunger or energy stays empty enabled in [Options](ui-elements/#options), prolonged deprivation can kill a housemate. New games enable this. A critical warning does not cancel your explicit orders, so cancel or replace a queue that keeps someone from food or sleep.

Death removes the person from active household life and releases their work and claims. Their identity, family connections and survivors' feelings remain available in the household history. Orders naming a dead partner cannot continue.

Survivors can grieve a person they liked. Stronger positive feelings produce stronger and longer grief, which fades over game time. Hatred produces no grief and no happiness bonus. A later newcomer does not grieve household deaths that occurred before they joined.

## Coming soon: weather preferences and longer calendars {#coming-soon}

Sims will have preferences for warmer or cooler weather. Weather they enjoy will slightly improve their mood; weather they dislike will slightly lower it. These effects are not available yet.

More weather variation from month to month and year to year is also planned. The current calendar keeps seven-day seasons and has no months. There is no release date for these additions.
