import * as Realm from 'realm-web';
import * as utils from './utils';

// The Worker's environment bindings. See `wrangler.toml` file.
interface Bindings {
    // MongoDB Realm Application ID
    REALM_APPID: string;
    REALM_APIKEY: string;
    MJ_APIKEY_PUBLIC: string;
    MJ_APIKEY_PRIVATE: string;
}

let App: Realm.App;
const ObjectId = Realm.BSON.ObjectID;

// Define type alias; available via `realm-web`
type Document = globalThis.Realm.Services.MongoDB.Document;

interface Schedule extends Document {
    name: string;
    start_date: Date;
    interval: number;
    active: boolean;
    formId: Realm.BSON.ObjectID;
}

interface ScheduleOnUser extends Document {
    scheduleId: Realm.BSON.ObjectID;
    userId: string;
    type: string;
}

interface User extends Document {
    name: string;
    email: string;
    type: "User" | "Admin";
}


// Define the Worker logic
const worker: ExportedHandler<Bindings> = {
    async fetch(req, env) {
        App = App || new Realm.App(env.REALM_APPID);

        try {
            const credentials = Realm.Credentials.apiKey(env.REALM_APIKEY);
            // Attempt to authenticate
            var user = await App.logIn(credentials);
            var client = user.mongoClient('mongodb-atlas');
        } catch (err) {
            return utils.toError('Error with authentication.', 500);
        }

        const schedules = client.db('db').collection<Schedule>('Schedule');

        const today_m = new Date();
        today_m.setSeconds(0);
        today_m.setHours(0);
        today_m.setMinutes(0);

        const today_e = new Date(today_m);

        today_e.setHours(23);
        today_e.setMinutes(59);
        today_e.setSeconds(59);

        const sched = await schedules.find({
            "start_date": {
                $gte: today_m,
                $lte: today_e
            }
        });

        const schedOnUsers = client.db('db').collection<ScheduleOnUser>('ScheduleOnUser');

        const users = await schedOnUsers.find({
            "scheduleId": {
                $in: sched.map(s => s._id)
            }
        });

        const mailableUsers = await client.db('db').collection<User>('User').find({
            _id: {
                $in: users.map(u => u.userId)
            },
            type: "User"
        });

        const emails = mailableUsers.map(u => u.email);

        const encoded = btoa(`${env.MJ_APIKEY_PUBLIC}:${env.MJ_APIKEY_PRIVATE}`);

        const response = await fetch('https://api.mailjet.com/v3.1/send', {
            method: 'POST',
            headers: {
                Authorization: `Basic ${encoded}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                "Messages": [
                    {
                        "From": {
                            "Email": "shoporders@mercyinaction.org.uk",
                            "Name": "MIA Stock Orders"
                        },
                        "To": emails.map(e => {
                            return {
                                "Email": e
                            };
                        }),
                        "Subject": "Please place your stock orders",
                        "HTMLPart": "<h3>It's time to place your stock orders</h3><p>Hi there, it's time to place your stock orders. Please login <a href='https://mercyinaction-shoporders.pages.dev/'>here</a> to place your orders.</p>"
                    }
                ]
            }),
        });

        if (!response.ok) {
            utils.toError('Error sending emails', 500);
        }

        return utils.reply(response);

    }
}

// Export for discoverability
export default worker;
