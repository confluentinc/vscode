# Generating a New Kafka Project on Confluent Cloud

1. Open the Command Palette.
2. Type "generate project" to find the command `Confluent: Project: Generate New Project`
3. Run the command and select which language you want the project to use. Options are Go, Java,
   KStreams, Python and a simple setup that emits records containing incrementing numbers which you
   can use to build a custom Kafka Connect source connector.
   > Projects require your Confluent Cloud **bootstrap server id**, **API key**, **API secret**,
   > **topic name** and **group id**.
4. All the scaffolding necessary for your new project will be generated and you're ready to get
   started developing with Kafka!
